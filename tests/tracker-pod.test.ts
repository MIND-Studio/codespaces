import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MC-160: the `.mind`-derived `flow:Tracker` is mirrored into the owner's pod
 * (`{podRoot}/codespaces/{repo}/.mind/`), public-read, and read back from there
 * by the dashboard. Exercised against an in-memory pod (no live CSS) — only
 * `getOwnerFetch` is mocked; everything else is the real
 * publish → ACL → GET → parse path.
 */

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
        return reply(url, null, store.has(url) || containers.has(url) ? 200 : 404);
      }
      if (method === "PUT") {
        if (url.endsWith("/")) containers.add(url);
        else store.set(url, String(init.body ?? ""));
        return reply(url, null, 201);
      }
      if (method === "DELETE") {
        store.delete(url);
        return reply(url, null, 200);
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

const CONTAINER = "http://localhost:3011/alice/codespaces/site/.mind/";

// Real folded Turtle — this repo's own committed tracker trio. Using the real
// build output proves publish → GET → parse end to end with conformant data.
const BUILD = join(process.cwd(), ".mind", "build");
const OUTPUTS = {
  tracker: readFileSync(join(BUILD, "tracker.ttl"), "utf8"),
  epics: readFileSync(join(BUILD, "epics.ttl"), "utf8"),
  state: readFileSync(join(BUILD, "state.ttl"), "utf8"),
};

beforeEach(() => {
  pod.store.clear();
  pod.containers.clear();
});

describe("tracker → pod mirror (MC-160)", () => {
  it("publishes the trio + a public-read ACL, idempotently", async () => {
    const { publishTrackerToPod, trackerContainerUrl } = await import("@/lib/solid/tracker-pod");
    expect(trackerContainerUrl(repo)).toBe(CONTAINER);

    const res = await publishTrackerToPod(repo, OUTPUTS);
    expect(res.container).toBe(CONTAINER);
    expect(pod.containers.has(CONTAINER)).toBe(true);
    expect(pod.store.has(`${CONTAINER}tracker.ttl`)).toBe(true);
    expect(pod.store.has(`${CONTAINER}epics.ttl`)).toBe(true);
    expect(pod.store.has(`${CONTAINER}state.ttl`)).toBe(true);

    // Public-read ACL: owner R/W/Control, foaf:Agent Read.
    const acl = pod.store.get(`${CONTAINER}.acl`);
    expect(acl).toContain("acl:Read, acl:Write, acl:Control");
    expect(acl).toContain("foaf:Agent");

    // Idempotent: a second publish leaves exactly the same docs.
    await publishTrackerToPod(repo, OUTPUTS);
    const docs = [...pod.store.keys()].filter((k) => k.endsWith(".ttl"));
    expect(docs.sort()).toEqual(
      [`${CONTAINER}epics.ttl`, `${CONTAINER}state.ttl`, `${CONTAINER}tracker.ttl`].sort(),
    );
  });

  it("the published tracker.ttl carries the flow:Tracker shape (mind-issues can render it)", async () => {
    const { publishTrackerToPod } = await import("@/lib/solid/tracker-pod");
    await publishTrackerToPod(repo, OUTPUTS);
    const trackerDoc = pod.store.get(`${CONTAINER}tracker.ttl`);
    // C6 regression guard: the same URL must be a conformant flow:Tracker with a
    // flow:stateStore pointer — what mind-issues / the SolidOS issue-pane read.
    expect(trackerDoc).toContain("a flow:Tracker");
    expect(trackerDoc).toContain("flow:stateStore");
  });

  it("reads the pod tracker back and parses it grouped by epic", async () => {
    const { publishTrackerToPod, readPodTracker } = await import("@/lib/solid/tracker-pod");
    await publishTrackerToPod(repo, OUTPUTS);

    const tracker = await readPodTracker(repo, "alice", "site");
    expect(tracker).not.toBeNull();
    expect(tracker?.title.length).toBeGreaterThan(0);
    expect(tracker?.issues.length).toBeGreaterThan(0);
    // Every issue carries a display number (the board groups + links by it).
    expect(tracker?.issues.every((i) => i.number != null)).toBe(true);
    // At least one epic was parsed from epics.ttl.
    expect(tracker?.epics.length).toBeGreaterThan(0);
  });

  it("returns null when the pod has no state.ttl (caller falls back to git)", async () => {
    const { readPodTracker } = await import("@/lib/solid/tracker-pod");
    // Nothing published → no state.ttl → null.
    expect(await readPodTracker(repo, "alice", "site")).toBeNull();
  });
});
