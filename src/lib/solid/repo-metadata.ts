import "server-only";
import type { Repo, PagesConfig } from "@/lib/registry/repos";
import { getOwnerFetch } from "@/lib/solid/fetch-for-owner";
import { ensureContainer, setPublicReadAcl } from "@/lib/solid/containers";
import { ensureInbox, inboxContainerUrl } from "@/lib/solid/inbox";
import { ensureMembers, membersUrl } from "@/lib/solid/members";
import { NS } from "@/lib/vocab";

/**
 * Path under the owner's pod root where repository metadata lives, one
 * Turtle document per repo:
 *
 *   {podRoot}/codespaces/{name}/index.ttl
 *
 * The container is created public-read so that other Solid-aware tools
 * can discover the repository description without authenticating.
 */
function metadataUrl(repo: Repo): string {
  const root = repo.ownerPodRoot.endsWith("/")
    ? repo.ownerPodRoot
    : `${repo.ownerPodRoot}/`;
  return `${root}codespaces/${repo.name}/index.ttl`;
}

function metadataContainer(repo: Repo): string {
  const root = repo.ownerPodRoot.endsWith("/")
    ? repo.ownerPodRoot
    : `${repo.ownerPodRoot}/`;
  return `${root}codespaces/${repo.name}/`;
}

function cloneUrlFor(repo: Repo): string {
  const base = process.env.BRIDGE_PUBLIC_URL ?? "http://localhost:3010";
  return `${base}/api/git/${repo.owner}/${repo.name}.git`;
}

/** Render the Turtle document the bridge writes into the pod. */
function renderTurtle(repo: Repo, pages: PagesConfig | null): string {
  const lines: string[] = [
    `@prefix solidgit: <${NS.solidgit}>.`,
    `@prefix dcterms: <${NS.dcterms}>.`,
    `@prefix xsd: <${NS.xsd}>.`,
    `@prefix ldp: <${NS.ldp}>.`,
    "",
    "<#repo>",
    "    a solidgit:Repository ;",
    `    solidgit:name ${JSON.stringify(repo.name)} ;`,
    `    solidgit:owner <${repo.ownerWebId}> ;`,
    `    solidgit:remote ${JSON.stringify(cloneUrlFor(repo))} ;`,
    `    solidgit:defaultBranch ${JSON.stringify(repo.defaultBranch)} ;`,
    `    solidgit:visibility ${JSON.stringify(repo.visibility)} ;`,
    `    dcterms:created "${new Date(repo.createdAt).toISOString()}"^^xsd:dateTime`,
  ];
  if (pages?.enabled && pages.targetContainer) {
    lines[lines.length - 1] += " ;";
    lines.push(`    solidgit:pagesEnabled true ;`);
    lines.push(
      `    solidgit:pagesSourceBranch ${JSON.stringify(pages.sourceBranch)} ;`,
    );
    lines.push(
      `    solidgit:pagesSourcePath ${JSON.stringify(pages.sourcePath)} ;`,
    );
    lines.push(
      `    solidgit:pagesTarget <${pages.targetContainer}>`,
    );
  }
  // Advertise the proposal inbox. `ldp:inbox` makes it discoverable by any
  // LDN-aware agent (the spec hook); `solidgit:proposalsEnabled` records
  // whether the bridge currently accepts proposals for this repo.
  lines[lines.length - 1] += " ;";
  lines.push(`    solidgit:proposalsEnabled ${repo.proposalsEnabled ? "true" : "false"} ;`);
  lines.push(`    ldp:inbox <${inboxContainerUrl(repo)}> ;`);
  // Advertise the membership roster so a member-aware tool (and the bridge's
  // own `requireMember`) can discover WebID→role from the pod (ADR-0002).
  lines.push(`    solidgit:members <${membersUrl(repo)}>`);
  lines[lines.length - 1] += " .";
  lines.push("");
  return lines.join("\n");
}

/**
 * Write the repo's metadata Turtle into the owner's pod. Best-effort —
 * the caller catches & logs failures rather than failing the user-facing
 * operation, since the pod might be temporarily offline.
 *
 * Retries once on a 401 because the Inrupt SDK's storage settles
 * asynchronously after the auth callback returns — the first fetch
 * issued by a freshly authorized session occasionally sends
 * unauthenticated. A second `getOwnerFetch` after a short delay reads
 * a fully-settled session and works. See bridge log
 * `unexpected response checking container ... 401` for the symptom.
 */
export async function writeRepoMetadata(
  repo: Repo,
  pages: PagesConfig | null,
): Promise<{ url: string; mode: "delegated" | "seeded" }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await writeRepoMetadataOnce(repo, pages);
    } catch (e) {
      const msg = (e as Error)?.message ?? "";
      const isFreshSession401 = attempt === 0 && /(:\s*401\b|401\s+Unauthorized)/.test(msg);
      if (!isFreshSession401) throw e;
      // SDK storage race — wait briefly and try again with a fresh
      // session. One retry only; persistent 401 means the user really
      // can't authenticate.
      await new Promise((r) => setTimeout(r, 750));
    }
  }
}

async function writeRepoMetadataOnce(
  repo: Repo,
  pages: PagesConfig | null,
): Promise<{ url: string; mode: "delegated" | "seeded" }> {
  const authed = await getOwnerFetch(repo.ownerWebId);

  try {
    await ensureCodespacesContainer(
      authed.fetch,
      repo.ownerPodRoot,
      repo.ownerWebId,
    );
    await ensureContainer(authed.fetch, metadataContainer(repo));
    // Provision the LDN proposal inbox while we already hold the owner's
    // authenticated fetch. Idempotent — only the first call writes the
    // append-only ACL.
    await ensureInbox(authed.fetch, repo);
    // Provision the (initially empty) membership roster + its ACL. Idempotent —
    // skips the write when a roster already exists, so members survive a
    // settings re-save (ADR-0002).
    await ensureMembers(authed.fetch, repo);

    const url = metadataUrl(repo);
    const body = renderTurtle(repo, pages);
    const res = await authed.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body,
    });
    if (!res.ok) {
      throw new Error(
        `PUT ${url} failed: ${res.status} ${res.statusText}`,
      );
    }
    return { url, mode: authed.mode };
  } finally {
    try {
      await authed.logout();
    } catch {
      /* ignore */
    }
  }
}

async function ensureCodespacesContainer(
  fetcher: typeof fetch,
  podRoot: string,
  ownerWebId: string,
): Promise<void> {
  const root = podRoot.endsWith("/") ? podRoot : `${podRoot}/`;
  const url = `${root}codespaces/`;
  const created = await ensureContainer(fetcher, url);
  if (created) {
    await setPublicReadAcl(fetcher, url, ownerWebId);
  }
}

// `ensureContainer` and `setPublicReadAcl` live in `@/lib/solid/containers`.
