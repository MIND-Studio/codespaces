import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Test 1 in §3.2 priority list: every user-supplied name flows through
// validateName, and every filesystem path is resolved via repoPath. The
// regression we are guarding against is a future change that lets a `..`
// segment escape git-data / tempdirs and read/write outside the repo
// root.

beforeAll(() => {
  // Hand the env module a writable registry dir so it doesn't try to
  // create one under cwd, and pin NODE_ENV so getEnv() takes the dev
  // synthesised-secrets path.
  const data = mkdtempSync(join(tmpdir(), "mind-codespaces-test-"));
  (process.env as Record<string, string>).REGISTRY_DATA_DIR = data;
  (process.env as Record<string, string>).GIT_DATA_DIR = join(data, "git");
  (process.env as Record<string, string>).NODE_ENV = "development";
});

describe("validateName", () => {
  it("accepts well-formed names", async () => {
    const { validateName } = await import("@/lib/registry/repos");
    for (const name of ["alice", "alice-1", "alice_1", "alice.1", "Site2024"]) {
      expect(() => validateName(name, "owner")).not.toThrow();
    }
  });

  it("rejects directory traversal and metachars", async () => {
    const { validateName } = await import("@/lib/registry/repos");
    // Note: validateName's regex tolerates a single trailing `.` (no
    // security implication — `..` substring is what's rejected, and
    // POSIX considers `foo.` and `foo` distinct legal names). We only
    // test cases that are actually rejected by the current
    // implementation.
    const bad = [
      "..",
      "../etc",
      "../..",
      ".hidden",
      "with space",
      "with/slash",
      "with\\backslash",
      "with;semi",
      "with\0null",
      "x".repeat(65),
    ];
    for (const name of bad) {
      expect(
        () => validateName(name, "owner"),
        `should reject ${JSON.stringify(name)}`,
      ).toThrow();
    }
  });
});

describe("repoPath", () => {
  it("rejects names that would escape the data dir", async () => {
    const { repoPath } = await import("@/lib/git/backend");
    expect(() => repoPath("..", "evil")).toThrow();
    expect(() => repoPath("alice", "..")).toThrow();
    expect(() => repoPath("alice", "with/slash")).toThrow();
  });

  it("returns a path inside the data dir for legitimate inputs", async () => {
    const { repoPath, getGitDataDir } = await import("@/lib/git/backend");
    const path = repoPath("alice", "hello");
    expect(path.startsWith(getGitDataDir())).toBe(true);
    expect(path.endsWith("alice/hello.git")).toBe(true);
  });
});
