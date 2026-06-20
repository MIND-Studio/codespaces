import { Parser, type Quad } from "n3";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MC-157: pod-native repo membership (ADR-0002). Exercised against an
 * in-memory pod (no live CSS), with only `getOwnerFetch` mocked.
 *
 *  - `renderMembersTurtle` is pure, so it round-trips through a real Turtle
 *    parser (n3): the roster's WebID→role entries parse back exactly, hostile
 *    WebIDs are dropped (never injected as triples), and duplicates collapse.
 *  - `addMember`/`removeMember`/`readMembers`/`resolveMemberRole` run against a
 *    Map-backed pod to pin the ADR-0002 ACL rule: adding a member to a
 *    **private** repo grants that member `acl:Read` on `pulls/` and the roster
 *    doc; a **public** repo needs no per-member grant.
 */

const SOLIDGIT = "https://mind-codespaces.local/vocab#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

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
      if (method === "DELETE") {
        store.delete(url);
        return reply(url, null, 200);
      }
      if (url.endsWith("/")) {
        const body = `@prefix ldp: <http://www.w3.org/ns/ldp#>.\n<${url}> a ldp:Container .\n`;
        return reply(url, body, 200);
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
const privateRepo = { ...repo, visibility: "private" as const };

const BOB = "http://localhost:3011/bob/profile/card#me";
const CAROL = "http://localhost:3011/carol/profile/card#me";
const MEMBERS_TTL = "http://localhost:3011/alice/codespaces/site/members.ttl";
const PULLS_ACL = "http://localhost:3011/alice/codespaces/site/pulls/.acl";

function parse(ttl: string): Quad[] {
  return new Parser({ baseIRI: MEMBERS_TTL }).parse(ttl);
}
function objectsOf(quads: Quad[], pred: string): string[] {
  return quads.filter((q) => q.predicate.value === pred).map((q) => q.object.value);
}

beforeEach(() => {
  pod.store.clear();
  pod.containers.clear();
});

describe("renderMembersTurtle (MC-157)", () => {
  it("round-trips the roster through a Turtle parser", async () => {
    const { renderMembersTurtle } = await import("@/lib/solid/members");
    const quads = parse(
      renderMembersTurtle(repo as never, [
        { webId: BOB, role: "writer" },
        { webId: CAROL, role: "reader" },
      ]),
    );
    // One Membership subject + two Member subjects.
    expect(
      quads.filter(
        (q) => q.predicate.value === RDF_TYPE && q.object.value === `${SOLIDGIT}Membership`,
      ),
    ).toHaveLength(1);
    expect(
      quads.filter((q) => q.predicate.value === RDF_TYPE && q.object.value === `${SOLIDGIT}Member`),
    ).toHaveLength(2);
    expect(objectsOf(quads, `${SOLIDGIT}agent`)).toEqual([BOB, CAROL]);
    expect(objectsOf(quads, `${SOLIDGIT}role`).sort()).toEqual(["reader", "writer"]);
    expect(objectsOf(quads, `${SOLIDGIT}hasMember`)).toHaveLength(2);
  });

  it("drops a hostile WebID and collapses duplicates", async () => {
    const { renderMembersTurtle } = await import("@/lib/solid/members");
    const quads = parse(
      renderMembersTurtle(repo as never, [
        { webId: "http://e/x> .\n<#evil> a <#y", role: "admin" }, // unsafe → dropped
        { webId: BOB, role: "reader" },
        { webId: BOB, role: "writer" }, // dup → first wins
      ]),
    );
    expect(objectsOf(quads, `${SOLIDGIT}agent`)).toEqual([BOB]);
    expect(objectsOf(quads, `${SOLIDGIT}role`)).toEqual(["reader"]);
    // The injection attempt minted no `#evil` subject.
    expect(quads.some((q) => q.subject.value.endsWith("#evil"))).toBe(false);
  });
});

describe("addMember / readMembers (MC-157)", () => {
  it("adds a member and reads the roster back", async () => {
    const { addMember, readMembers } = await import("@/lib/solid/members");
    await addMember(repo as never, BOB, "writer");
    expect(pod.store.has(MEMBERS_TTL)).toBe(true);
    const roster = await readMembers(repo as never);
    expect(roster).toEqual([{ webId: BOB, role: "writer" }]);
  });

  it("updates a member's role in place (no duplicate)", async () => {
    const { addMember, readMembers } = await import("@/lib/solid/members");
    await addMember(repo as never, BOB, "reader");
    await addMember(repo as never, BOB, "admin");
    expect(await readMembers(repo as never)).toEqual([{ webId: BOB, role: "admin" }]);
  });

  it("grants the member acl:Read on pulls/ for a PRIVATE repo", async () => {
    const { addMember } = await import("@/lib/solid/members");
    await addMember(privateRepo as never, BOB, "reader");
    const acl = pod.store.get(PULLS_ACL);
    expect(acl).toBeDefined();
    expect(acl).toContain(BOB);
    expect(acl).toContain("acl:Read");
    expect(acl).toContain(repo.ownerWebId); // owner keeps full control
    expect(acl).not.toContain("foaf:Agent"); // never world-readable
    // The roster doc itself also carries the member-read grant.
    expect(pod.store.get(`${MEMBERS_TTL}.acl`)).toContain(BOB);
  });

  it("applies NO per-member ACL on a PUBLIC repo (already public-read)", async () => {
    const { addMember } = await import("@/lib/solid/members");
    await addMember(repo as never, BOB, "reader");
    // applyMemberAcls early-returns for public repos, so no pulls/ ACL is written.
    expect(pod.store.has(PULLS_ACL)).toBe(false);
  });
});

describe("removeMember (MC-157)", () => {
  it("drops the member and re-applies the ACL without them", async () => {
    const { addMember, removeMember, readMembers } = await import("@/lib/solid/members");
    await addMember(privateRepo as never, BOB, "writer");
    await addMember(privateRepo as never, CAROL, "reader");
    await removeMember(privateRepo as never, BOB);
    expect(await readMembers(privateRepo as never)).toEqual([{ webId: CAROL, role: "reader" }]);
    const acl = pod.store.get(PULLS_ACL);
    expect(acl).toContain(CAROL);
    expect(acl).not.toContain(BOB); // revoked
  });
});

describe("resolveMemberRole (MC-157)", () => {
  it("treats the owner as an implicit admin without a pod read", async () => {
    const { resolveMemberRole } = await import("@/lib/solid/members");
    expect(await resolveMemberRole(repo as never, repo.ownerWebId)).toBe("admin");
  });

  it("resolves a member's role and returns null for a stranger", async () => {
    const { addMember, resolveMemberRole } = await import("@/lib/solid/members");
    await addMember(repo as never, BOB, "writer");
    expect(await resolveMemberRole(repo as never, BOB)).toBe("writer");
    expect(await resolveMemberRole(repo as never, CAROL)).toBeNull();
  });
});
