import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mergeBranches } from "@/lib/git/merge";

function makeBareRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "merge-empty-bare-"));
  execSync("git init --bare --initial-branch=main", { cwd: root });
  return root;
}

function commitOnBranch(
  bareRepoPath: string,
  branch: string,
  filename: string,
  contents: string,
): string {
  const work = mkdtempSync(join(tmpdir(), "merge-empty-work-"));
  try {
    execSync(`git clone --no-checkout "${bareRepoPath}" "${work}"`, {
      stdio: "ignore",
    });
    execSync(`git -C "${work}" checkout --orphan ${branch}`, { stdio: "ignore" });
    execSync(`git -C "${work}" rm -rf --cached . 2>/dev/null || true`, {
      shell: "/bin/sh",
    });
    writeFileSync(join(work, filename), contents);
    execSync(`git -C "${work}" add -A`, { stdio: "ignore" });
    execSync(`git -C "${work}" -c user.email=t@t -c user.name=t commit -m initial`, {
      stdio: "ignore",
    });
    execSync(`git -C "${work}" push origin ${branch}`, { stdio: "ignore" });
    const sha = execSync(`git -C "${work}" rev-parse HEAD`).toString().trim();
    return sha;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

describe("mergeBranches — empty target branch", () => {
  it("seeds the missing target ref from source instead of erroring", async () => {
    const bare = makeBareRepo();
    try {
      // Bare repo has agent/issue-1 as its only branch; main does not exist.
      const sha = commitOnBranch(
        bare,
        "agent/issue-1",
        "index.html",
        "<!doctype html><h1>seeded</h1>\n",
      );
      // Sanity: main should not exist yet.
      const refs = execSync(`git -C "${bare}" show-ref`).toString();
      expect(refs).toContain("refs/heads/agent/issue-1");
      expect(refs).not.toContain("refs/heads/main\n");

      const result = await mergeBranches(
        bare,
        "agent/issue-1",
        "main",
        "Merge pull request #1",
        { name: "alice", email: "https://example.org/alice#me" },
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.mergeSha).toBe(sha);

      // main now points at the source SHA on the bare.
      const mainSha = execSync(`git -C "${bare}" rev-parse refs/heads/main`)
        .toString()
        .trim();
      expect(mainSha).toBe(sha);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("returns a clean error when neither target nor source exist", async () => {
    const bare = makeBareRepo();
    try {
      const result = await mergeBranches(
        bare,
        "agent/issue-1",
        "main",
        "Merge pull request #1",
        { name: "alice", email: "https://example.org/alice#me" },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.conflict).toBe(false);
        expect(result.message).toMatch(/source branch.*not found/);
      }
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });
});
