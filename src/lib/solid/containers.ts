import "server-only";

/**
 * Shared helpers for managing LDP containers and their `.acl` resources
 * on a Solid pod. Used by both the Pages publisher (creates `/public/…`)
 * and the repo-metadata writer (creates `/codespaces/…`).
 *
 * All helpers accept the caller's authenticated `fetch` — the caller
 * decides whether that's a delegated session, the seeded fallback, or
 * something else. This module makes no assumptions about who.
 */

/**
 * Ensure a container exists at `url`. Returns `true` if we created it,
 * `false` if it already existed. Throws on any other error.
 */
export async function ensureContainer(
  fetcher: typeof fetch,
  url: string,
): Promise<boolean> {
  const head = await fetcher(url, { method: "HEAD" });
  if (head.ok) return false;
  if (head.status !== 404) {
    throw new Error(
      `unexpected response checking container ${url}: ${head.status}`,
    );
  }
  const put = await fetcher(url, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
      Link: '<http://www.w3.org/ns/ldp#Container>; rel="type"',
    },
  });
  if (!put.ok && put.status !== 409 /* already exists */) {
    throw new Error(
      `failed to create container ${url}: ${put.status} ${put.statusText}`,
    );
  }
  return true;
}

/**
 * Idempotently PUT a public-read default ACL onto `containerUrl`. The
 * owner WebID gets Read/Write/Control; `foaf:Agent` (anyone, including
 * unauthenticated) gets Read. The `default` predicate makes children
 * inherit the same ACL.
 */
export async function setPublicReadAcl(
  fetcher: typeof fetch,
  containerUrl: string,
  ownerWebId: string,
): Promise<void> {
  const aclUrl = `${containerUrl}.acl`;
  const body = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.

<#owner>
    a acl:Authorization;
    acl:agent <${ownerWebId}>;
    acl:accessTo <${containerUrl}>;
    acl:default <${containerUrl}>;
    acl:mode acl:Read, acl:Write, acl:Control.

<#public-read>
    a acl:Authorization;
    acl:agentClass foaf:Agent;
    acl:accessTo <${containerUrl}>;
    acl:default <${containerUrl}>;
    acl:mode acl:Read.
`;
  const res = await fetcher(aclUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `failed to set public-read ACL on ${aclUrl}: ${res.status} ${res.statusText}`,
    );
  }
}

/**
 * Idempotently PUT an owner-only ACL onto `containerUrl`: the owner WebID
 * gets Read/Write/Control with `acl:default` (so children inherit), and
 * nobody else gets anything. This is the **private**-repo counterpart to
 * `setPublicReadAcl` — used for pod artifacts that must not be world-readable.
 *
 * Per ADR-0002, a private repo's collaboration artifacts (e.g. `pulls/`) are
 * owner-only today; a member `Read` grant is the membership-epic (#157)
 * follow-up and will be layered on here without changing the owner rule.
 */
export async function setOwnerOnlyAcl(
  fetcher: typeof fetch,
  containerUrl: string,
  ownerWebId: string,
): Promise<void> {
  const aclUrl = `${containerUrl}.acl`;
  const body = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.

<#owner>
    a acl:Authorization;
    acl:agent <${ownerWebId}>;
    acl:accessTo <${containerUrl}>;
    acl:default <${containerUrl}>;
    acl:mode acl:Read, acl:Write, acl:Control.
`;
  const res = await fetcher(aclUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `failed to set owner-only ACL on ${aclUrl}: ${res.status} ${res.statusText}`,
    );
  }
}

/**
 * Idempotently PUT an owner-plus-members ACL onto `containerUrl`: the owner
 * gets Read/Write/Control and each member WebID gets `acl:Read`, all with
 * `acl:default` so children inherit. No public rule — this is the **private**
 * repo grant once the repo has members (ADR-0002: a member's only pod-level
 * privilege is `Read` on a private repo; they never get direct WAC write —
 * the bridge stays sole writer via the owner's delegated fetch).
 *
 * Members are interpolated into `<…>` IRIs, so each is validated as a safe
 * http(s) IRI first; a malformed WebID is dropped (it loses access rather than
 * smuggling a triple into the ACL). With no valid members this is exactly
 * `setOwnerOnlyAcl`.
 */
export async function setMemberReadAcl(
  fetcher: typeof fetch,
  containerUrl: string,
  ownerWebId: string,
  memberWebIds: string[],
): Promise<void> {
  const aclUrl = `${containerUrl}.acl`;
  const members = memberWebIds.filter(isSafeAclIri);
  const memberRules = members
    .map(
      (webId, i) => `
<#member-${i}>
    a acl:Authorization;
    acl:agent <${webId}>;
    acl:accessTo <${containerUrl}>;
    acl:default <${containerUrl}>;
    acl:mode acl:Read.
`,
    )
    .join("");
  const body = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.

<#owner>
    a acl:Authorization;
    acl:agent <${ownerWebId}>;
    acl:accessTo <${containerUrl}>;
    acl:default <${containerUrl}>;
    acl:mode acl:Read, acl:Write, acl:Control.
${memberRules}`;
  const res = await fetcher(aclUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `failed to set member-read ACL on ${aclUrl}: ${res.status} ${res.statusText}`,
    );
  }
}

/**
 * Validate a value is a safe http(s) IRI to interpolate into an ACL `<…>`.
 * Mirrors the guard in `inbox.ts` — rejects anything that could break out of
 * the angle brackets or smuggle a triple.
 */
function isSafeAclIri(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      // Reject control chars + space, and any char that could break out of
      // the ACL `<...>`: < > " { } | backslash ^ ` (backtick).
      if (c <= 0x20) return false;
      if (
        c === 0x3c || c === 0x3e || c === 0x22 || c === 0x7b || c === 0x7d ||
        c === 0x7c || c === 0x5c || c === 0x5e || c === 0x60
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Idempotently set a container's ACL to match the repo's visibility:
 * `public` → public-read (`setPublicReadAcl`); `private` → owner-only
 * (`setOwnerOnlyAcl`), or owner-plus-members (`setMemberReadAcl`) when the
 * repo has members. This is the ADR-0002 rule for collaboration artifacts
 * written into the owner's pod: public repos are world-readable, private
 * repos are readable only by the owner and the members the bridge has
 * recorded in `members.ttl`.
 */
export async function setVisibilityAcl(
  fetcher: typeof fetch,
  containerUrl: string,
  ownerWebId: string,
  visibility: "public" | "private",
  memberWebIds: string[] = [],
): Promise<void> {
  if (visibility === "private") {
    if (memberWebIds.length > 0) {
      await setMemberReadAcl(fetcher, containerUrl, ownerWebId, memberWebIds);
    } else {
      await setOwnerOnlyAcl(fetcher, containerUrl, ownerWebId);
    }
  } else {
    await setPublicReadAcl(fetcher, containerUrl, ownerWebId);
  }
}

/**
 * Idempotently PUT an append-only inbox ACL onto `containerUrl` (a
 * Linked Data Notifications inbox). The owner gets Read/Write/Control with
 * `acl:default` so they (and only they) can list and read the proposals
 * that land here. When `publicAppend` is set, `foaf:Agent` (anyone,
 * including unauthenticated) additionally gets `acl:Append` — they can POST
 * a new notification but, crucially, get **no `acl:default`**, so they can
 * neither read the listing nor any sibling notification. That asymmetry is
 * the whole point of an inbox: write-only for the public, read for the owner.
 *
 * By default `publicAppend` is off — the bridge mediates every write with
 * the owner's delegated fetch (validated + rate-limited), so the pod ACL
 * stays owner-only-writable. Flip it on to also accept direct LDN POSTs
 * from external Solid agents.
 */
export async function setInboxAcl(
  fetcher: typeof fetch,
  containerUrl: string,
  ownerWebId: string,
  opts: { publicAppend?: boolean } = {},
): Promise<void> {
  const aclUrl = `${containerUrl}.acl`;
  const publicRule = opts.publicAppend
    ? `
<#public-append>
    a acl:Authorization;
    acl:agentClass foaf:Agent;
    acl:accessTo <${containerUrl}>;
    acl:mode acl:Append.
`
    : "";
  const body = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.

<#owner>
    a acl:Authorization;
    acl:agent <${ownerWebId}>;
    acl:accessTo <${containerUrl}>;
    acl:default <${containerUrl}>;
    acl:mode acl:Read, acl:Write, acl:Control.
${publicRule}`;
  const res = await fetcher(aclUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `failed to set inbox ACL on ${aclUrl}: ${res.status} ${res.statusText}`,
    );
  }
}
