import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Checkout a single branch from a bare repository into a fresh temporary
 * directory. Caller MUST call the returned `cleanup()` when done.
 *
 * Uses `git clone --depth 1 --single-branch --no-tags <bare> <tempDir>`
 * which is the simplest way to materialize one branch's tree without
 * pulling history.
 */
export async function checkoutBranchToTempDir(
  bareRepoPath: string,
  branch: string,
): Promise<{ tempDir: string; cleanup: () => Promise<void> }> {
  const tempDir = await mkdtemp(join(tmpdir(), "mind-codespaces-publish-"));
  try {
    await runGit([
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--branch",
      branch,
      "--no-tags",
      bareRepoPath,
      tempDir,
    ]);
  } catch (e) {
    await rm(tempDir, { recursive: true, force: true });
    throw e;
  }
  return {
    tempDir,
    cleanup: async () => {
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

function runGit(args: string[]): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", rejectFn);
    child.on("close", (code) => {
      if (code === 0) resolveFn();
      else rejectFn(new Error(`git ${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}
