import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Test 5 in §3.2 priority list: the publisher walk must not yield:
//   • dot-prefixed config (`.env*`)
//   • `.git`, `node_modules`, `.next`, `.cache`
//   • OS junk (`.DS_Store`)
//   • files matching the secrets prefix/extension list
//   • symlinks of any kind (point them at `/` and the walker would
//     otherwise enumerate the host fs)
// Regression guard: any change that removes a directory from
// FORBIDDEN_DIRS or relaxes the symlink lstat() check shows up here.

let walk: (root: string) => AsyncIterable<string>;

beforeAll(async () => {
  const data = mkdtempSync(join(tmpdir(), "mind-codespaces-test-"));
  (process.env as Record<string, string>).REGISTRY_DATA_DIR = data;
  (process.env as Record<string, string>).GIT_DATA_DIR = join(data, "git");
  (process.env as Record<string, string>).NODE_ENV = "development";
  // walk is not exported; reach in via module internals through a helper.
  // Pattern: publisher.ts exports publishDirectory which calls walk; we
  // smoke-test via a fixture and observe which files end up in `kept`.
  // For a *unit* test of walk specifically, expose it via a tiny shim:
  const mod = await import("@/lib/pages/publisher");
  // The exported surface doesn't include walk, so we test via the
  // `kept` set populated during a real publishDirectory call. To keep
  // this test fast we monkey-patch the publisher's pod uploads to a
  // no-op fetch that just records URLs.
  void mod;
  walk = (await import("@/lib/pages/publisher")).walk;
});

describe("publisher.walk", () => {
  it("excludes secrets, dotfiles, and symlinks", async () => {
    const root = mkdtempSync(join(tmpdir(), "mind-codespaces-walk-"));
    // legitimate content
    writeFileSync(join(root, "index.html"), "<h1>ok</h1>");
    mkdirSync(join(root, "css"));
    writeFileSync(join(root, "css", "site.css"), "body{}");
    // forbidden dirs
    mkdirSync(join(root, ".git"));
    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main");
    mkdirSync(join(root, "node_modules"));
    writeFileSync(join(root, "node_modules", "left-pad.js"), "module.exports = '';");
    mkdirSync(join(root, ".ssh"));
    writeFileSync(join(root, ".ssh", "id_rsa"), "PRIVATE KEY");
    // forbidden file patterns
    writeFileSync(join(root, ".env"), "OPENROUTER_API_KEY=sk-leak");
    writeFileSync(join(root, ".env.local"), "FOO=BAR");
    writeFileSync(join(root, "credentials.json"), `{"key":"value"}`);
    writeFileSync(join(root, "site.pem"), "-----BEGIN CERTIFICATE-----");
    writeFileSync(join(root, ".DS_Store"), "macOS junk");
    // symlink to /
    try {
      symlinkSync("/", join(root, "evil"));
    } catch {
      /* CI may forbid root symlinks; skip in that case */
    }

    const yielded: string[] = [];
    for await (const file of walk(root)) {
      yielded.push(file.replace(root + "/", ""));
    }
    // Allowed files surface.
    expect(yielded.some((p) => p.endsWith("index.html"))).toBe(true);
    expect(yielded.some((p) => p.endsWith("css/site.css"))).toBe(true);
    // Forbidden patterns never surface.
    for (const bad of [
      ".git/HEAD",
      "node_modules/left-pad.js",
      ".ssh/id_rsa",
      ".env",
      ".env.local",
      "credentials.json",
      "site.pem",
      ".DS_Store",
      "evil",
    ]) {
      expect(
        yielded.find((p) => p.endsWith(bad)),
        `walk yielded a forbidden path: ${bad}`,
      ).toBeUndefined();
    }
  });
});
