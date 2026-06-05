import { describe, expect, it } from "vitest";
import { suggestKind } from "@/lib/collab/suggest-kind";

describe("suggestKind", () => {
  it("treats a short focused write-up as an issue", () => {
    const r = suggestKind(
      "Login takes >3s on a cold start. Profile the bridge and cache the keypair.",
    );
    expect(r.kind).toBe("issue");
    expect(r.reason).toMatch(/focused/);
  });

  it("treats an empty draft as an issue", () => {
    expect(suggestKind("").kind).toBe("issue");
  });

  it("suggests an epic when an epic keyword appears", () => {
    expect(suggestKind("This is a milestone for v0.9.").kind).toBe("epic");
    expect(suggestKind("## Phase 1\nDo the thing.").kind).toBe("epic");
    expect(suggestKind("Break this into sub-issues.").kind).toBe("epic");
  });

  it("suggests an epic for a long checklist of deliverables", () => {
    const md = [
      "Work to do:",
      "- [ ] one",
      "- [ ] two",
      "- [ ] three",
      "- [ ] four",
      "- [ ] five",
    ].join("\n");
    const r = suggestKind(md);
    expect(r.kind).toBe("epic");
    expect(r.reason).toMatch(/checklist/);
  });

  it("suggests an epic for many sections", () => {
    const md = "## Goal\ntext\n## Scope\ntext\n## Risks\ntext";
    expect(suggestKind(md).kind).toBe("epic");
  });

  it("does not count headings/checkboxes inside fenced code as structure", () => {
    const md = [
      "A focused fix.",
      "```md",
      "## not a real section",
      "## also not",
      "## nor this",
      "```",
    ].join("\n");
    expect(suggestKind(md).kind).toBe("issue");
  });

  it("keeps a short two-section note as an issue (needs length too)", () => {
    const md = "## What\nA small change.\n## Why\nBecause.";
    expect(suggestKind(md).kind).toBe("issue");
  });
});
