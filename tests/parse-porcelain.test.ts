import { execSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePorcelain } from "@/lib/agents/drivers/coder";

describe("parsePorcelain — documented git status shapes", () => {
  it.each([
    [" M index.html", "index.html"],
    ["?? index.html", "index.html"],
    ["M  index.html", "index.html"],
    ["MM index.html", "index.html"],
    [" D foo.txt", "foo.txt"],
    ["A  bar.txt", "bar.txt"],
  ])("%s -> %s", (input, expected) => {
    expect(parsePorcelain(input)).toEqual([expected]);
  });

  it("rename: RX  old -> new returns just the destination", () => {
    expect(parsePorcelain("R  old.html -> new.html")).toEqual(["new.html"]);
  });

  it("multiline output", () => {
    expect(parsePorcelain(" M index.html\n?? README.md\n")).toEqual(["index.html", "README.md"]);
  });

  it("quoted paths with special chars", () => {
    expect(parsePorcelain('?? "weird name.txt"')).toEqual(["weird name.txt"]);
  });
});

describe("parsePorcelain — against real git output", () => {
  it("recovers index.html from a real Edit-on-existing-file scenario", () => {
    const bare = mkdtempSync(join(tmpdir(), "pp-bare-"));
    const work = mkdtempSync(join(tmpdir(), "pp-work-"));
    try {
      execSync("git init --bare --initial-branch=main", { cwd: bare });
      execSync(`git clone "${bare}" "${work}"`, { stdio: "ignore" });
      writeFileSync(join(work, "index.html"), "<!doctype html><h1>v1</h1>\n");
      execSync(`git -C "${work}" -c user.email=t@t -c user.name=t add index.html`);
      execSync(`git -C "${work}" -c user.email=t@t -c user.name=t commit -m initial`, {
        stdio: "ignore",
      });
      execSync(`git -C "${work}" push origin main`, { stdio: "ignore" });
      // Now mutate the file (the iteration scenario).
      appendFileSync(join(work, "index.html"), "<!-- patched -->\n");
      const raw = execSync(`git -C "${work}" status --porcelain -uall`).toString();
      const parsed = parsePorcelain(raw.trimEnd());
      expect(parsed).toEqual(["index.html"]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
      rmSync(work, { recursive: true, force: true });
    }
  });

  it("recovers two filenames when one is modified and one is untracked", () => {
    const bare = mkdtempSync(join(tmpdir(), "pp-bare-"));
    const work = mkdtempSync(join(tmpdir(), "pp-work-"));
    try {
      execSync("git init --bare --initial-branch=main", { cwd: bare });
      execSync(`git clone "${bare}" "${work}"`, { stdio: "ignore" });
      writeFileSync(join(work, "index.html"), "<!doctype html>\n");
      execSync(`git -C "${work}" -c user.email=t@t -c user.name=t add index.html`);
      execSync(`git -C "${work}" -c user.email=t@t -c user.name=t commit -m initial`, {
        stdio: "ignore",
      });
      execSync(`git -C "${work}" push origin main`, { stdio: "ignore" });
      appendFileSync(join(work, "index.html"), "<!-- patched -->\n");
      writeFileSync(join(work, "README.md"), "# hello\n");
      const raw = execSync(`git -C "${work}" status --porcelain -uall`).toString();
      const parsed = parsePorcelain(raw.trimEnd());
      expect(parsed.sort()).toEqual(["README.md", "index.html"]);
    } finally {
      rmSync(bare, { recursive: true, force: true });
      rmSync(work, { recursive: true, force: true });
    }
  });
});
