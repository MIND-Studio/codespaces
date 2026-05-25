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
