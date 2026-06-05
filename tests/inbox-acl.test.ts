import { describe, it, expect } from "vitest";
import { setInboxAcl } from "@/lib/solid/containers";

// The inbox ACL is the security boundary of the whole proposals feature:
// the owner must be able to read/manage the inbox, and — only when
// explicitly opted in — the public may *append* (POST a notification) but
// never read it. A regression that handed the public `acl:default` or any
// read mode would leak every proposer's submission to every other one.

function captureAcl() {
  let body = "";
  let url = "";
  const fetcher = (async (u: string, init?: RequestInit) => {
    url = String(u);
    body = String(init?.body ?? "");
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  return { fetcher, get: () => ({ url, body }) };
}

const INBOX = "http://localhost:3011/alice/codespaces/site/inbox/";
const OWNER = "http://localhost:3011/alice/profile/card#me";

describe("inbox ACL", () => {
  it("writes the .acl next to the container", async () => {
    const cap = captureAcl();
    await setInboxAcl(cap.fetcher, INBOX, OWNER);
    expect(cap.get().url).toBe(`${INBOX}.acl`);
  });

  it("grants the owner Read/Write/Control with default inheritance", async () => {
    const cap = captureAcl();
    await setInboxAcl(cap.fetcher, INBOX, OWNER);
    const body = cap.get().body;
    expect(body).toContain(`acl:agent <${OWNER}>`);
    expect(body).toContain("acl:mode acl:Read, acl:Write, acl:Control");
    expect(body).toContain(`acl:default <${INBOX}>`);
  });

  it("by default grants the public NOTHING (bridge-mediated writes)", async () => {
    const cap = captureAcl();
    await setInboxAcl(cap.fetcher, INBOX, OWNER);
    const body = cap.get().body;
    expect(body).not.toContain("foaf:Agent");
    expect(body).not.toContain("acl:Append");
  });

  it("with publicAppend, grants foaf:Agent Append but NO read and NO default", async () => {
    const cap = captureAcl();
    await setInboxAcl(cap.fetcher, INBOX, OWNER, { publicAppend: true });
    const body = cap.get().body;
    expect(body).toContain("acl:agentClass foaf:Agent");
    expect(body).toContain("acl:mode acl:Append");

    // The public rule must not carry Read or a default — isolate it and check.
    const publicRule = body.slice(body.indexOf("#public-append"));
    expect(publicRule).not.toContain("acl:Read");
    expect(publicRule).not.toContain("acl:default");
  });
});
