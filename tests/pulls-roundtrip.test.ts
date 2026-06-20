import { Parser, type Quad } from "n3";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MC-142: opening a PR writes pod-native Turtle, parallel to how issues are
 * mirrored. Two layers are exercised here against no live CSS:
 *
 *  - `renderPullTurtle` is pure, so it round-trips through a real Turtle parser
 *    (n3): the emitted bytes must parse to exactly the triples we expect, with
 *    hostile titles/bodies preserved as *data* (never injected triples), the
 *    creator triple omitted for agent-authored PRs, and `solidgit:closesIssue`
 *    present only when a linked issue is supplied.
 *  - `writePullToPod` is exercised against a Map-backed in-memory pod (only
 *    `getOwnerFetch` + the issue lookup are mocked) to pin the ADR-0002 ACL
 *    rule: `pulls/` is public-read on a public repo, owner-only on a private one.
 */

const SOLIDGIT = "https://mind-codespaces.local/vocab#";
const SIOC = "http://rdfs.org/sioc/ns#";

// A minimal in-memory Solid pod (Map-backed), built in vi.hoisted so the
// getOwnerFetch mock can close over it. Mirrors tests/inbox-roundtrip.ts.
const { pod } = vi.hoisted(() => {
  function makePod() {
    const store = new Map<string, string>();
    const containers = new Set<string>();
    const reply = (url: string, body: BodyInit | null, status: number) => {
      const res = new Response(body, {
        status,
        headers: { "content-type": "text/turtle" },
      });
      Object.defineProperty(res, "url", { value: url });
      return res;
    };
    const fetch = (async (input: string, init: RequestInit = {}) => {
      const url = String(input);
      const method = (init.method ?? "GET").toUpperCase();
      if (method === "HEAD") {
        const exists = store.has(url) || containers.has(url);
        return reply(url, null, exists ? 200 : 404);
      }
      if (method === "PUT") {
        if (url.endsWith("/")) containers.add(url);
        else store.set(url, String(init.body ?? ""));
        return reply(url, null, 201);
      }
      const body = store.get(url);
      if (body === undefined) return reply(url, null, 404);
      return reply(url, body, 200);
    }) as unknown as typeof globalThis.fetch;
    return { fetch, store, containers };
  }
  return { pod: makePod() };
});

vi.mock("@/lib/solid/fetch-for-owner", () => ({
  getOwnerFetch: async () => ({
    fetch: pod.fetch,
    mode: "seeded" as const,
    logout: async () => {},
  }),
  OwnerFetchUnavailableError: class OwnerFetchUnavailableError extends Error {},
}));

// The PR→issue link resolution reads the issues registry; mock just the lookup.
const { getIssueById } = vi.hoisted(() => ({ getIssueById: vi.fn() }));
vi.mock("@/lib/registry/issues", () => ({ getIssueById }));

const repo = {
  id: 1,
  owner: "alice",
  name: "site",
  ownerWebId: "http://localhost:3011/alice/profile/card#me",
  ownerPodRoot: "http://localhost:3011/alice/",
  defaultBranch: "main",
  visibility: "public" as const,
  createdAt: 0,
  proposalsEnabled: true,
  collabEnabled: true,
};

function makePull(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    repoId: 1,
    number: 3,
    title: "Add dark mode",
    body: "Implements the toggle.",
    sourceBranch: "agent/issue-0142",
    targetBranch: "main",
    sourceSha: "abc1234",
    status: "open" as const,
    authorWebId: "http://localhost:3011/bob/profile/card#me",
    issueId: null,
    agentRunId: null,
    mergeSha: null,
    createdAt: Date.UTC(2026, 5, 6, 2, 0, 0),
    updatedAt: Date.UTC(2026, 5, 6, 2, 0, 0),
    mergedAt: null,
    closedAt: null,
    previewStatus: null,
    previewUrl: null,
    previewSha: null,
    previewLogPath: null,
    previewError: null,
    ...over,
  };
}

function parse(ttl: string): Quad[] {
  return new Parser({
    baseIRI: "http://localhost:3011/alice/codespaces/site/pulls/3/pull.ttl",
  }).parse(ttl);
}
function objectsOf(quads: Quad[], pred: string): string[] {
  return quads.filter((q) => q.predicate.value === pred).map((q) => q.object.value);
}

beforeEach(() => {
  pod.store.clear();
  pod.containers.clear();
  getIssueById.mockReset();
});

describe("renderPullTurtle (MC-142)", () => {
  it("round-trips through a Turtle parser with the expected triples", async () => {
    const { renderPullTurtle } = await import("@/lib/solid/pulls");
    const quads = parse(renderPullTurtle(repo as never, makePull() as never));

    expect(objectsOf(quads, `${SOLIDGIT}number`)).toContain("3");
    expect(objectsOf(quads, "http://purl.org/dc/terms/title")).toContain("Add dark mode");
    expect(objectsOf(quads, `${SOLIDGIT}status`)).toContain("open");
    expect(objectsOf(quads, `${SOLIDGIT}sourceBranch`)).toContain("agent/issue-0142");
    expect(objectsOf(quads, `${SOLIDGIT}targetBranch`)).toContain("main");
    expect(objectsOf(quads, `${SIOC}has_creator`)).toContain(
      "http://localhost:3011/bob/profile/card#me",
    );
    // typed as a PullRequest
    expect(
      quads.some(
        (q) =>
          q.predicate.value === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" &&
          q.object.value === `${SOLIDGIT}PullRequest`,
      ),
    ).toBe(true);
  });

  it("preserves hostile title/body as data — no injected triples", async () => {
    const { renderPullTurtle } = await import("@/lib/solid/pulls");
    const hostile = makePull({
      title: 'evil" ; solidgit:status "merged',
      body: 'line1\n"""\nsolidgit:number "999"^^<x> .\n<#x> a <#y>',
    });
    const quads = parse(renderPullTurtle(repo as never, hostile as never));

    // The hostile title survives verbatim as the literal, and status is still
    // exactly "open" — the injection attempt did not become a triple.
    expect(objectsOf(quads, "http://purl.org/dc/terms/title")).toContain(
      'evil" ; solidgit:status "merged',
    );
    expect(objectsOf(quads, `${SOLIDGIT}status`)).toEqual(["open"]);
    expect(objectsOf(quads, `${SOLIDGIT}number`)).toEqual(["3"]);
  });

  it("agent-authored PR (no author) omits the creator triple but stays valid", async () => {
    const { renderPullTurtle } = await import("@/lib/solid/pulls");
    const quads = parse(renderPullTurtle(repo as never, makePull({ authorWebId: null }) as never));
    expect(objectsOf(quads, `${SIOC}has_creator`)).toHaveLength(0);
    // still a well-formed PullRequest with a number
    expect(objectsOf(quads, `${SOLIDGIT}number`)).toContain("3");
  });

  it("emits solidgit:closesIssue only when a linked issue is given", async () => {
    const { renderPullTurtle } = await import("@/lib/solid/pulls");
    const without = parse(renderPullTurtle(repo as never, makePull() as never));
    expect(objectsOf(without, `${SOLIDGIT}closesIssue`)).toHaveLength(0);

    const url = "http://localhost:3011/alice/codespaces/site/issues/7/issue.ttl";
    const withLink = parse(
      renderPullTurtle(repo as never, makePull() as never, { closesIssueUrl: url }),
    );
    expect(objectsOf(withLink, `${SOLIDGIT}closesIssue`)).toContain(url);
  });
});

describe("writePullToPod (MC-142)", () => {
  it("writes pull.ttl and a public-read ACL on a public repo", async () => {
    const { writePullToPod, pullUrl } = await import("@/lib/solid/pulls");
    const res = await writePullToPod(repo as never, makePull() as never);

    const url = pullUrl(repo as never, 3);
    expect(res.url).toBe(url);
    expect(pod.store.has(url)).toBe(true);

    const acl = pod.store.get("http://localhost:3011/alice/codespaces/site/pulls/.acl");
    expect(acl).toBeDefined();
    expect(acl).toContain("foaf:Agent"); // public-read rule present
    expect(acl).toContain("acl:Read");
  });

  it("writes an owner-only ACL on a private repo (no public rule)", async () => {
    const { writePullToPod } = await import("@/lib/solid/pulls");
    await writePullToPod({ ...repo, visibility: "private" } as never, makePull() as never);
    const acl = pod.store.get("http://localhost:3011/alice/codespaces/site/pulls/.acl");
    expect(acl).toBeDefined();
    expect(acl).not.toContain("foaf:Agent"); // no public access on a private repo
    expect(acl).toContain(repo.ownerWebId); // owner still has access
  });

  it("resolves solidgit:closesIssue from the PR's linked issueId", async () => {
    getIssueById.mockReturnValue({ id: 99, repoId: 1, number: 7 });
    const { writePullToPod, pullUrl } = await import("@/lib/solid/pulls");
    await writePullToPod(repo as never, makePull({ issueId: 99 }) as never);

    const ttl = pod.store.get(pullUrl(repo as never, 3))!;
    expect(ttl).toContain(
      "solidgit:closesIssue <http://localhost:3011/alice/codespaces/site/issues/7/issue.ttl>",
    );
  });
});
