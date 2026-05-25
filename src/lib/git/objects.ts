import "server-only";
import { spawn } from "node:child_process";

/**
 * Read-only Git plumbing wrappers for the code browser. All helpers spawn
 * the system `git` binary with `--git-dir=<bareRepoPath>` so they never
 * touch a working tree. Outputs are normalised into small TypeScript
 * shapes (TreeEntry, etc.) so callers don't have to parse Git's own
 * output formats.
 */

export type TreeEntry = {
  mode: string;
  type: "tree" | "blob" | "commit"; // commit = submodule
  sha: string;
  size: number | null;
  name: string;
};

export type BlobContent = {
  bytes: Buffer;
  isBinary: boolean;
  truncated: boolean;
  totalSize: number;
};

const MAX_BLOB_DISPLAY_BYTES = 256 * 1024; // 256 KB — anything larger is binary-ish for the browser

/** Common README filenames, in lookup order. First hit wins. */
const README_CANDIDATES = [
  "README.md",
  "Readme.md",
  "readme.md",
  "README.markdown",
  "README",
  "readme",
] as const;

/**
 * Look for a README at the repo root under `ref`. Returns the matched
 * filename + UTF-8 content, or null if none of the candidates exist.
 * Only the root level is searched — sub-directory READMEs aren't surfaced
 * on the repo overview.
 */
export async function findReadme(
  bareRepoPath: string,
  ref: string,
): Promise<{ name: string; content: string } | null> {
  for (const name of README_CANDIDATES) {
    const blob = await readBlob(bareRepoPath, ref, name);
    if (blob && !blob.isBinary) {
      return { name, content: blob.bytes.toString("utf-8") };
    }
  }
  return null;
}

/** True if the repo has at least one commit reachable from HEAD. */
export async function hasAnyCommits(bareRepoPath: string): Promise<boolean> {
  const { code } = await runGit(bareRepoPath, [
    "rev-parse",
    "--verify",
    "--quiet",
    "HEAD",
  ]);
  return code === 0;
}

/** List all branches with their tip SHAs. */
export async function listBranches(
  bareRepoPath: string,
): Promise<Array<{ name: string; sha: string }>> {
  const { stdout, code, stderr } = await runGit(bareRepoPath, [
    "for-each-ref",
    "--format=%(refname:short)%09%(objectname)",
    "refs/heads/",
  ]);
  if (code !== 0) throw new Error(`for-each-ref failed: ${stderr}`);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, sha] = line.split("\t");
      return { name, sha };
    });
}

/**
 * List one level of the tree at `path` under `ref`. `path` may be "" for
 * the repo root. Returns directories first, then files, alphabetical.
 */
export async function listTree(
  bareRepoPath: string,
  ref: string,
  path: string,
): Promise<TreeEntry[]> {
  const target = path ? `${ref}:${path}` : ref;
  const { stdout, code, stderr } = await runGit(bareRepoPath, [
    "ls-tree",
    "--long",
    target,
  ]);
  if (code !== 0) {
    // `bad revision` on empty repos, or path doesn't exist on this ref.
    if (/Not a valid object name|bad revision|exists on disk/i.test(stderr)) {
      return [];
    }
    throw new Error(`ls-tree ${target} failed: ${stderr}`);
  }
  const entries: TreeEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    // Format: <mode> SP <type> SP <sha> SP* <size> TAB <name>
    const tabIdx = line.indexOf("\t");
    if (tabIdx < 0) continue;
    const meta = line.slice(0, tabIdx).trim().split(/\s+/);
    const name = line.slice(tabIdx + 1);
    if (meta.length < 4) continue;
    const [mode, type, sha, sizeStr] = meta;
    if (type !== "tree" && type !== "blob" && type !== "commit") continue;
    entries.push({
      mode,
      type,
      sha,
      size: sizeStr === "-" ? null : Number.parseInt(sizeStr, 10),
      name,
    });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "tree" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

/**
 * Read a blob at `path` under `ref`. If the blob is larger than the
 * display cap, only the first chunk is returned (`truncated: true`).
 * Binary detection is a heuristic — null byte in the first chunk.
 */
export async function readBlob(
  bareRepoPath: string,
  ref: string,
  path: string,
): Promise<BlobContent | null> {
  // First, get the blob's full size and verify it exists / is a blob.
  const sizeProbe = await runGit(bareRepoPath, [
    "cat-file",
    "-s",
    `${ref}:${path}`,
  ]);
  if (sizeProbe.code !== 0) return null;
  const totalSize = Number.parseInt(sizeProbe.stdout.trim(), 10);

  const typeProbe = await runGit(bareRepoPath, [
    "cat-file",
    "-t",
    `${ref}:${path}`,
  ]);
  if (typeProbe.code !== 0 || typeProbe.stdout.trim() !== "blob") {
    return null;
  }

  const { bytes, code, stderr } = await runGitBytes(bareRepoPath, [
    "cat-file",
    "blob",
    `${ref}:${path}`,
  ]);
  if (code !== 0) throw new Error(`cat-file failed: ${stderr}`);

  const truncated = bytes.length > MAX_BLOB_DISPLAY_BYTES;
  const display = truncated ? bytes.subarray(0, MAX_BLOB_DISPLAY_BYTES) : bytes;
  const isBinary = looksBinary(display);

  return { bytes: display, isBinary, truncated, totalSize };
}

function looksBinary(buf: Buffer): boolean {
  // Null byte in the first 8 KB is a strong signal.
  const window = buf.subarray(0, Math.min(buf.length, 8192));
  for (let i = 0; i < window.length; i++) {
    if (window[i] === 0) return true;
  }
  return false;
}

type GitResult = { stdout: string; stderr: string; code: number };
type GitBytesResult = { bytes: Buffer; stderr: string; code: number };

function runGit(bareRepoPath: string, args: string[]): Promise<GitResult> {
  return new Promise((resolveFn) => {
    const child = spawn("git", [`--git-dir=${bareRepoPath}`, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) =>
      resolveFn({ stdout, stderr: stderr + err.message, code: -1 }),
    );
    child.on("close", (code) =>
      resolveFn({ stdout, stderr, code: code ?? -1 }),
    );
  });
}

function runGitBytes(
  bareRepoPath: string,
  args: string[],
): Promise<GitBytesResult> {
  return new Promise((resolveFn) => {
    const child = spawn("git", [`--git-dir=${bareRepoPath}`, ...args]);
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) =>
      resolveFn({ bytes: Buffer.concat(chunks), stderr: stderr + err.message, code: -1 }),
    );
    child.on("close", (code) =>
      resolveFn({ bytes: Buffer.concat(chunks), stderr, code: code ?? -1 }),
    );
  });
}
