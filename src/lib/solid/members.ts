import "server-only";
import { getSolidDataset, getStringNoLocale, getThingAll, getUrl } from "@inrupt/solid-client";
import type { Repo } from "@/lib/registry/repos";
import { ensureContainer, setVisibilityAcl } from "@/lib/solid/containers";
import { getOwnerFetch } from "@/lib/solid/fetch-for-owner";
import { NS } from "@/lib/vocab";

/**
 * Pod-native repo membership (ADR-0002). A single Turtle document in the
 * owner's pod lists `WebID → role`; the bridge reads it through the owner's
 * delegated fetch to authorize collaboration writes, and stays the sole
 * writer to the pod. A member is a *capability the bridge enforces*, not a
 * WAC write-principal on the owner's pod — the only real pod-level grant a
 * member receives is `acl:Read` on a **private** repo's collaboration
 * containers (public repos are already public-read).
 *
 * Path layout under the owner's pod root:
 *
 *   {podRoot}/codespaces/{repo}/members.ttl   (the roster — owner-writable)
 *
 * The `/codespaces/{repo}/` container already exists from `repo-metadata`.
 */

function trailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function membersUrl(repo: Repo): string {
  return `${trailingSlash(repo.ownerPodRoot)}codespaces/${repo.name}/members.ttl`;
}

function repoIndexUrl(repo: Repo): string {
  return `${trailingSlash(repo.ownerPodRoot)}codespaces/${repo.name}/index.ttl#repo`;
}

// The `pulls/` collaboration container, computed locally to avoid a
// `pulls.ts ↔ members.ts` import cycle (pulls reads members, not vice-versa).
function pullsContainer(repo: Repo): string {
  return `${trailingSlash(repo.ownerPodRoot)}codespaces/${repo.name}/pulls/`;
}

export type MemberRole = "reader" | "writer" | "admin";

/** Privilege ranking — higher satisfies a lower `minRole` requirement. */
export const ROLE_RANK: Record<MemberRole, number> = {
  reader: 1,
  writer: 2,
  admin: 3,
};

export function isMemberRole(s: string): s is MemberRole {
  return s === "reader" || s === "writer" || s === "admin";
}

export type Member = { webId: string; role: MemberRole };

/**
 * A WebID is interpolated into an `<...>` IRI in the roster and the ACL, so a
 * hostile value could inject a triple. WebIDs reaching here come from the
 * signed session or an admin action, but we validate before trusting any as an
 * IRI — a malformed one is dropped (it loses access) rather than smuggled in.
 * Numeric char-code checks avoid escape ambiguity.
 */
export function isSafeWebId(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c <= 0x20) return false;
      if (
        c === 0x3c ||
        c === 0x3e ||
        c === 0x22 ||
        c === 0x7b ||
        c === 0x7d ||
        c === 0x7c ||
        c === 0x5c ||
        c === 0x5e ||
        c === 0x60
      )
        return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Render the roster as Turtle. Pure (no I/O) so it round-trips in a unit
 * test. Malformed WebIDs are dropped; duplicate WebIDs collapse to the
 * last-wins entry (the writer dedups before calling, but render is defensive).
 */
export function renderMembersTurtle(repo: Repo, members: Member[]): string {
  const seen = new Set<string>();
  const safe: Member[] = [];
  for (const m of members) {
    if (!isSafeWebId(m.webId) || !isMemberRole(m.role)) continue;
    if (seen.has(m.webId)) continue;
    seen.add(m.webId);
    safe.push(m);
  }

  const lines = [
    `@prefix solidgit: <${NS.solidgit}>.`,
    "",
    "<#membership>",
    "    a solidgit:Membership ;",
    `    solidgit:repository <${repoIndexUrl(repo)}>`,
  ];
  if (safe.length > 0) {
    lines[lines.length - 1] += " ;";
    lines.push(`    solidgit:hasMember ${safe.map((_, i) => `<#m${i}>`).join(", ")} .`);
  } else {
    lines[lines.length - 1] += " .";
  }
  lines.push("");
  safe.forEach((m, i) => {
    lines.push(`<#m${i}>`);
    lines.push("    a solidgit:Member ;");
    lines.push(`    solidgit:agent <${m.webId}> ;`);
    lines.push(`    solidgit:role "${m.role}" .`);
    lines.push("");
  });
  return lines.join("\n");
}

/**
 * Read the roster with a caller-supplied authed fetch (no new session). Lets a
 * caller already holding the owner's delegated fetch (e.g. the PR writer)
 * thread the current members into a container's ACL without a second login.
 * Empty on absence/transient error.
 */
export async function readMembersWithFetch(fetcher: typeof fetch, repo: Repo): Promise<Member[]> {
  return fetchRoster(fetcher, repo);
}

/** Parse the roster from an already-fetched pod dataset URL. */
async function fetchRoster(fetcher: typeof fetch, repo: Repo): Promise<Member[]> {
  let ds;
  try {
    ds = await getSolidDataset(membersUrl(repo), { fetch: fetcher });
  } catch {
    // 404 (never provisioned) or transient — treat as an empty roster.
    return [];
  }
  const out: Member[] = [];
  const seen = new Set<string>();
  for (const thing of getThingAll(ds)) {
    const webId = getUrl(thing, `${NS.solidgit}agent`);
    const role = getStringNoLocale(thing, `${NS.solidgit}role`);
    if (!webId || !role || !isMemberRole(role)) continue;
    if (seen.has(webId)) continue;
    seen.add(webId);
    out.push({ webId, role });
  }
  return out;
}

/** PUT the roster document with the owner's authed fetch. */
async function putRoster(fetcher: typeof fetch, repo: Repo, members: Member[]): Promise<void> {
  const url = membersUrl(repo);
  const res = await fetcher(url, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: renderMembersTurtle(repo, members),
  });
  if (!res.ok) {
    throw new Error(`PUT ${url} failed: ${res.status} ${res.statusText}`);
  }
}

/**
 * Re-apply the visibility ACL on the repo's private collaboration containers
 * so the current roster's members get `acl:Read`. Public repos need no change
 * (already public-read). The `pulls/` container is the concrete artifact this
 * epic gates (ADR-0002's #142 corollary: owner+member-read for private repos);
 * it is ensured so the grant has a target. The roster document itself is also
 * granted member-read so members can see who is on the repo.
 *
 * Best-effort per container — one container failing does not abort the rest.
 */
async function applyMemberAcls(
  fetcher: typeof fetch,
  repo: Repo,
  members: Member[],
): Promise<void> {
  if (repo.visibility !== "private") return;
  const memberWebIds = members.map((m) => m.webId);
  const pulls = pullsContainer(repo);
  await ensureContainer(fetcher, pulls);
  await setVisibilityAcl(fetcher, pulls, repo.ownerWebId, "private", memberWebIds);
  // The roster document (a resource, not a container) — owner write, member read.
  await setVisibilityAcl(fetcher, membersUrl(repo), repo.ownerWebId, "private", memberWebIds);
}

/** List the repo's members (owner fetch). Empty if the roster is absent. */
export async function readMembers(repo: Repo): Promise<Member[]> {
  const authed = await getOwnerFetch(repo.ownerWebId);
  try {
    return await fetchRoster(authed.fetch, repo);
  } finally {
    try {
      await authed.logout();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Resolve a WebID's effective role on a repo. The owner is an implicit
 * `admin` (no pod read needed — the common case). Anyone else is looked up in
 * the roster; returns null if they are not a member.
 */
export async function resolveMemberRole(repo: Repo, webId: string): Promise<MemberRole | null> {
  if (webId === repo.ownerWebId) return "admin";
  const roster = await readMembers(repo);
  return roster.find((m) => m.webId === webId)?.role ?? null;
}

/**
 * Provision an empty roster + its ACL during repo-metadata writes (idempotent,
 * mirrors `ensureInbox`). Only writes when the roster does not already exist so
 * an existing roster is never clobbered.
 */
export async function ensureMembers(fetcher: typeof fetch, repo: Repo): Promise<void> {
  const head = await fetcher(membersUrl(repo), { method: "HEAD" });
  if (head.ok) return; // already provisioned — leave the roster as-is
  await putRoster(fetcher, repo, []);
  await applyMemberAcls(fetcher, repo, []);
}

/**
 * Add (or update the role of) a member, then grant the matching pod ACLs.
 * Returns the updated roster. Owner-mediated: the bridge writes as the owner
 * via the delegated fetch; the member never writes the owner's pod directly.
 */
export async function addMember(repo: Repo, webId: string, role: MemberRole): Promise<Member[]> {
  if (!isSafeWebId(webId)) {
    throw new Error(`refusing to add unsafe WebID: ${JSON.stringify(webId)}`);
  }
  const authed = await getOwnerFetch(repo.ownerWebId);
  try {
    const roster = await fetchRoster(authed.fetch, repo);
    const next = roster.filter((m) => m.webId !== webId);
    next.push({ webId, role });
    await putRoster(authed.fetch, repo, next);
    await applyMemberAcls(authed.fetch, repo, next);
    return next;
  } finally {
    try {
      await authed.logout();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Remove a member, then re-apply the pod ACLs without them (revocation is a
 * single roster write + ACL rewrite — atomic, unlike spraying WAC grants).
 * Returns the updated roster.
 */
export async function removeMember(repo: Repo, webId: string): Promise<Member[]> {
  const authed = await getOwnerFetch(repo.ownerWebId);
  try {
    const roster = await fetchRoster(authed.fetch, repo);
    const next = roster.filter((m) => m.webId !== webId);
    await putRoster(authed.fetch, repo, next);
    await applyMemberAcls(authed.fetch, repo, next);
    return next;
  } finally {
    try {
      await authed.logout();
    } catch {
      /* ignore */
    }
  }
}
