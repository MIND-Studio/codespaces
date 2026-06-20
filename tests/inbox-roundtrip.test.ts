import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end exercise of the LDN inbox module against an in-memory pod —
 * no live CSS, no Next request scope. Only `getOwnerFetch` is mocked (its
 * delegated/seeded resolution needs a real pod); everything else is the
 * real serialize → container-list → parse → delete path.
 *
 * The hostile-input case is the load-bearing one: a proposal whose title
 * and body try to inject Turtle must round-trip as *data*, producing
 * exactly one inbox member with the literal text preserved — never extra
 * triples.
 */

// A minimal in-memory Solid pod (Map-backed) shared across getOwnerFetch
// calls. Built in `vi.hoisted` so the mock factory can close over it.
const { pod } = vi.hoisted(() => {
  function makePod() {
    const store = new Map<string, string>(); // resource url -> turtle body
    const containers = new Set<string>();

    // solid-client reads `response.url` as the resource IRI; a bare
    // `new Response()` has an empty url, so stamp it on every reply.
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
      // GET
      if (url.endsWith("/")) {
        const children = [...store.keys()].filter(
          (k) => k.startsWith(url) && !k.slice(url.length).includes("/") && !k.endsWith(".acl"),
        );
        const contains = children.length
          ? ` ;\n    ldp:contains ${children.map((c) => `<${c}>`).join(", ")}`
          : "";
        const body = `@prefix ldp: <http://www.w3.org/ns/ldp#>.\n<${url}> a ldp:Container${contains} .\n`;
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

const INBOX = "http://localhost:3011/alice/codespaces/site/inbox/";

beforeEach(() => {
  pod.store.clear();
  pod.containers.clear();
});

describe("inbox round-trip", () => {
  it("provisions the inbox + ACL, then serializes and parses a proposal back", async () => {
    const { postProposal, listProposals } = await import("@/lib/solid/inbox");

    const at = Date.UTC(2026, 5, 5, 18, 30, 0);
    await postProposal(repo, {
      title: "Please add dark mode",
      body: "The site is blinding at night.",
      proposerWebId: "http://localhost:3011/bob/profile/card#me",
      contact: null,
      createdMs: at,
    });

    // ensureInbox wrote the append-only ACL.
    expect(pod.store.has(`${INBOX}.acl`)).toBe(true);

    const proposals = await listProposals(repo);
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect(p.title).toBe("Please add dark mode");
    expect(p.body).toBe("The site is blinding at night.");
    expect(p.proposerWebId).toBe("http://localhost:3011/bob/profile/card#me");
    expect(p.contact).toBeNull();
    expect(p.createdAt).toBe(at);
  });

  it("preserves hostile Turtle as data — no injected triples", async () => {
    const { postProposal, listProposals } = await import("@/lib/solid/inbox");

    const hostileTitle = 'Pwn "me" now';
    const hostileBody = 'line one\n""" .\n<#evil> <http://ex/p> <http://ex/o> .\n"""more';
    await postProposal(repo, {
      title: hostileTitle,
      body: hostileBody,
      proposerWebId: null,
      contact: "anon@example.com",
      createdMs: Date.UTC(2026, 5, 5, 19, 0, 0),
    });

    const proposals = await listProposals(repo);
    // Exactly one member — the injection did not mint a second resource/triple
    // the lister would pick up.
    expect(proposals).toHaveLength(1);
    expect(proposals[0].title).toBe(hostileTitle);
    expect(proposals[0].body).toBe(hostileBody);
    expect(proposals[0].proposerWebId).toBeNull();
    expect(proposals[0].contact).toBe("anon@example.com");
  });

  it("round-trips a body that ends in a quote (no malformed Turtle)", async () => {
    const { postProposal, listProposals } = await import("@/lib/solid/inbox");

    // A naive `"""…"""` wrapper would merge the trailing quote with the closing
    // delimiter and produce Turtle the pod rejects.
    const body = 'He said "hi"';
    await postProposal(repo, {
      title: "quote ending",
      body,
      proposerWebId: null,
      contact: null,
      createdMs: Date.UTC(2026, 5, 5, 20, 0, 0),
    });

    const proposals = await listProposals(repo);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].body).toBe(body);
  });

  it("drops a malformed proposer WebID instead of injecting an IRI", async () => {
    const { postProposal, listProposals } = await import("@/lib/solid/inbox");

    // A WebID that tries to break out of `<…>` and smuggle a triple must not be
    // trusted — provenance is dropped, but no `#evil` subject appears.
    await postProposal(repo, {
      title: "bad webid",
      body: "",
      proposerWebId: "http://e/x> .\n<#evil> <http://ex/p> <http://ex/o",
      contact: null,
      createdMs: Date.UTC(2026, 5, 5, 20, 5, 0),
    });

    const proposals = await listProposals(repo);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].proposerWebId).toBeNull();
  });

  it("dismiss deletes the notification", async () => {
    const { postProposal, listProposals, deleteProposal } = await import("@/lib/solid/inbox");

    const { id } = await postProposal(repo, {
      title: "first",
      body: "",
      proposerWebId: null,
      contact: null,
      createdMs: Date.UTC(2026, 5, 5, 18, 0, 0),
    });
    await postProposal(repo, {
      title: "second",
      body: "",
      proposerWebId: null,
      contact: null,
      createdMs: Date.UTC(2026, 5, 5, 18, 5, 0),
    });
    expect(await listProposals(repo)).toHaveLength(2);

    expect(await deleteProposal(repo, id)).toBe(true);
    const after = await listProposals(repo);
    expect(after).toHaveLength(1);
    expect(after[0].title).toBe("second");

    // A malformed id is rejected without touching the pod.
    expect(await deleteProposal(repo, "../../etc/passwd")).toBe(false);
  });

  it("sorts newest first", async () => {
    const { postProposal, listProposals } = await import("@/lib/solid/inbox");
    await postProposal(repo, {
      title: "older",
      body: "",
      proposerWebId: null,
      contact: null,
      createdMs: Date.UTC(2026, 5, 1),
    });
    await postProposal(repo, {
      title: "newer",
      body: "",
      proposerWebId: null,
      contact: null,
      createdMs: Date.UTC(2026, 5, 5),
    });
    const proposals = await listProposals(repo);
    expect(proposals.map((p) => p.title)).toEqual(["newer", "older"]);
  });
});
