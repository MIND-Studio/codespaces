import "server-only";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export type MergeAuthor = {
  /** Display name for the merge commit author. */
  name: string;
  /** Email field. We put the merger's WebID URL here so the commit
   *  carries a verifiable identity link and `git log` shows it inline. */
  email: string;
};

/**
 * Merge `source` into `target` on a bare repo via a `--no-ff` merge
 * commit in a throwaway worktree, then push the result back. Returns
 * the merge commit's SHA on success.
 *
 * The merge commit's author + committer fields come from `author` so
 * the human-in-the-loop who clicked "merge" (typically the repo owner)
 * shows up in `git log`, not the bridge service.
 *
 * Why a throwaway clone? Plumbing-only (`read-tree -m`, `commit-tree`,
 * `update-ref`) would skip the disk round-trip but adds a non-trivial
 * amount of error handling. For prototype scale the boring path —
 * clone + porcelain merge + push — is enough and uses git's own
 * conflict detection unchanged.
 *
 * Conflicts surface as { ok: false, conflict: true, message } so the
 * caller can map them to a 409 instead of a 500.
 */
export async function mergeBranches(
  bareRepoPath: string,
  source: string,
  target: string,
  message: string,
  author: MergeAuthor,
): Promise<
  | { ok: true; mergeSha: string }
  | { ok: false; conflict: boolean; message: string }
> {
  // Empty-target fast-path. When the target branch doesn't exist on
  // the bare yet (fresh repo whose first commit is the agent's own,
  // before anyone has pushed `main`), `checkout target` below fails
  // with `pathspec 'target' did not match any file(s)`. There is
  // nothing to merge — the source IS the entire history — so make
  // the target ref point at source via a push, which also fires the
  // post-receive hook so the publisher chain triggers.
  const probe = await sh("git", [
    "-C",
    bareRepoPath,
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${target}`,
  ]);
  if (probe.exit !== 0) {
    const sourceProbe = await sh("git", [
      "-C",
      bareRepoPath,
      "rev-parse",
      "--verify",
      `refs/heads/${source}`,
    ]);
    if (sourceProbe.exit !== 0) {
      return {
        ok: false,
        conflict: false,
        message: `source branch ${source} not found on bare repo`,
      };
    }
    const sourceSha = sourceProbe.stdout.trim();
    const seedDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "mind-pr-seed-"),
    );
    try {
      const clone = await sh("git", [
        "clone",
        "--no-checkout",
        bareRepoPath,
        seedDir,
      ]);
      if (clone.exit !== 0) {
        return {
          ok: false,
          conflict: false,
          message: `seed clone failed: ${clone.stderr || clone.stdout}`,
        };
      }
      const push = await sh("git", [
        "-C",
        seedDir,
        "push",
        "origin",
        `${sourceSha}:refs/heads/${target}`,
      ]);
      if (push.exit !== 0) {
        return {
          ok: false,
          conflict: false,
          message: `seed push failed: ${push.stderr || push.stdout}`,
        };
      }
      return { ok: true, mergeSha: sourceSha };
    } finally {
      await fs.rm(seedDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  const workDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "mind-pr-merge-"),
  );
  try {
    const clone = await sh("git", ["clone", bareRepoPath, workDir]);
    if (clone.exit !== 0) {
      return {
        ok: false,
        conflict: false,
        message: `clone failed: ${clone.stderr || clone.stdout}`,
      };
    }
    for (const args of [
      ["-C", workDir, "config", "user.email", author.email],
      ["-C", workDir, "config", "user.name", author.name],
      ["-C", workDir, "checkout", target],
      ["-C", workDir, "fetch", "origin", source],
    ]) {
      const r = await sh("git", args);
      if (r.exit !== 0) {
        return {
          ok: false,
          conflict: false,
          message: `git ${args[2]} failed: ${r.stderr || r.stdout}`,
        };
      }
    }
    const merge = await sh("git", [
      "-C",
      workDir,
      "merge",
      "--no-ff",
      "-m",
      message,
      `origin/${source}`,
    ]);
    if (merge.exit !== 0) {
      // Git uses exit=1 for "conflicts present" and exit>=128 for
      // anything fatal. The stderr/stdout typically mentions
      // "CONFLICT" on conflict.
      const conflict = /CONFLICT/i.test(merge.stdout + merge.stderr);
      return {
        ok: false,
        conflict,
        message: (merge.stderr || merge.stdout || "merge failed").slice(0, 800),
      };
    }
    const headSha = (await sh("git", ["-C", workDir, "rev-parse", "HEAD"])).stdout.trim();
    const push = await sh("git", ["-C", workDir, "push", "origin", target]);
    if (push.exit !== 0) {
      return {
        ok: false,
        conflict: false,
        message: `push failed: ${push.stderr || push.stdout}`,
      };
    }
    return { ok: true, mergeSha: headSha };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

type ShResult = { exit: number; stdout: string; stderr: string };
function sh(cmd: string, args: string[]): Promise<ShResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exit: code ?? 0, stdout, stderr });
    });
  });
}
