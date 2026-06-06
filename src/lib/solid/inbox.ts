import "server-only";
import { randomUUID } from "node:crypto";
import {
  getSolidDataset,
  getContainedResourceUrlAll,
  getThing,
  getStringNoLocale,
  getUrl,
  getDatetime,
} from "@inrupt/solid-client";
import type { Repo } from "@/lib/registry/repos";
import { getOwnerFetch } from "@/lib/solid/fetch-for-owner";
import { ensureContainer, setInboxAcl } from "@/lib/solid/containers";
import { NS } from "@/lib/vocab";

/**
 * The repo's Linked Data Notifications inbox — a pod-native `ldp:inbox`
 * where anyone (including unauthenticated visitors) can drop an *issue
 * proposal*. The owner alone can list and read it; accepting a proposal
 * mints a `.mind` issue at `todo`, dismissing deletes the
 * notification. The container is the untrusted staging area; the `.mind`
 * tracker stays owner-authored.
 *
 *   {podRoot}/codespaces/{repo}/inbox/                  (the ldp:inbox)
 *   {podRoot}/codespaces/{repo}/inbox/{uuid}.ttl        (one proposal)
 *
 * Writes are bridge-mediated with the owner's delegated fetch (validated +
 * rate-limited upstream), so the pod ACL is owner-only-writable by default.
 * Set `INBOX_PUBLIC_APPEND=1` to additionally open `acl:Append` to
 * `foaf:Agent` for direct LDN POSTs from external Solid agents.
 */

function trailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function inboxContainerUrl(repo: Repo): string {
  return `${trailingSlash(repo.ownerPodRoot)}codespaces/${repo.name}/inbox/`;
}

/** A proposal as it lands from the propose route (untrusted input). */
export type ProposalInput = {
  title: string;
  body: string;
  /** WebID of a signed-in proposer, if any. */
  proposerWebId?: string | null;
  /** Free-text name/contact an anonymous proposer optionally left. */
  contact?: string | null;
  /** Epoch ms; passed in so callers control the clock (tests, fold sort). */
  createdMs: number;
};

/** A proposal as read back from the pod for the owner to triage. */
export type Proposal = {
  id: string;
  url: string;
  title: string;
  body: string;
  proposerWebId: string | null;
  contact: string | null;
  createdAt: number | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Triple-quoted Turtle long string — keeps newlines literal. Every `"` is
 * escaped individually (`\"`), which is always valid inside `"""…"""` and,
 * crucially, also handles a body that *ends* in a quote (e.g. `He said "hi"`):
 * a bare trailing `"` would otherwise merge with the closing `"""` and produce
 * malformed Turtle the pod rejects.
 */
function quote(s: string): string {
  return `"""${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"""`;
}

/**
 * A WebID is interpolated into an `<…>` IRI, so — unlike the escaped literals —
 * a hostile value could inject a triple. WebIDs come from the signed session
 * (never the request body), but a self-hosted IdP could still assert a
 * malformed one, so we validate before trusting it as an IRI.
 */
function isSafeIri(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    // Reject anything that could break out of `<…>` or smuggle a triple.
    return !/[\u0000-\u0020<>"{}|\\^\u0060]/.test(value);
  } catch {
    return false;
  }
}

/**
 * Render one proposal notification as Turtle. Every untrusted literal is
 * escaped (triple-quote for the multi-line body, `JSON.stringify` for the
 * single-line title/contact) so a hostile proposal can't inject triples.
 * The shape is flat (everything on `<>`) so it reads back trivially with
 * `getThing(dataset, documentUrl)`.
 */
export function renderProposalTurtle(input: ProposalInput): string {
  const lines = [
    `@prefix as: <${NS.as}>.`,
    `@prefix solidgit: <${NS.solidgit}>.`,
    `@prefix dcterms: <${NS.dcterms}>.`,
    `@prefix xsd: <${NS.xsd}>.`,
    `@prefix sioc: <${NS.sioc}>.`,
    "",
    "<>",
    "    a as:Announce, solidgit:IssueProposal ;",
    `    dcterms:title ${JSON.stringify(input.title)} ;`,
    `    sioc:content ${quote(input.body)} ;`,
    `    dcterms:created "${new Date(input.createdMs).toISOString()}"^^xsd:dateTime`,
  ];
  // Only emit `as:actor` for a well-formed IRI — a malformed WebID is dropped
  // (provenance lost, but no triple injection) rather than trusted as-is.
  if (input.proposerWebId && isSafeIri(input.proposerWebId)) {
    lines[lines.length - 1] += " ;";
    lines.push(`    as:actor <${input.proposerWebId}>`);
  }
  if (input.contact) {
    lines[lines.length - 1] += " ;";
    lines.push(`    solidgit:contact ${JSON.stringify(input.contact)}`);
  }
  lines[lines.length - 1] += " .";
  lines.push("");
  return lines.join("\n");
}

/** Ensure the inbox container + its append-only ACL exist. Idempotent. */
export async function ensureInbox(
  fetcher: typeof fetch,
  repo: Repo,
): Promise<void> {
  const url = inboxContainerUrl(repo);
  const created = await ensureContainer(fetcher, url);
  if (created) {
    await setInboxAcl(fetcher, url, repo.ownerWebId, {
      publicAppend: process.env.INBOX_PUBLIC_APPEND === "1",
    });
  }
}

/**
 * Write a proposal into the owner's inbox using the owner's delegated
 * fetch. Returns the created resource's id + url. Best-effort caller
 * pattern: the route catches & maps failures.
 */
export async function postProposal(
  repo: Repo,
  input: ProposalInput,
): Promise<{ id: string; url: string }> {
  const authed = await getOwnerFetch(repo.ownerWebId);
  try {
    await ensureInbox(authed.fetch, repo);
    const id = randomUUID();
    const url = `${inboxContainerUrl(repo)}${id}.ttl`;
    const res = await authed.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body: renderProposalTurtle(input),
    });
    if (!res.ok) {
      throw new Error(`PUT ${url} failed: ${res.status} ${res.statusText}`);
    }
    return { id, url };
  } finally {
    try {
      await authed.logout();
    } catch {
      /* ignore */
    }
  }
}

function idFromUrl(memberUrl: string): string | null {
  const last = memberUrl.replace(/\/$/, "").split("/").pop() ?? "";
  const id = last.endsWith(".ttl") ? last.slice(0, -4) : last;
  return UUID_RE.test(id) ? id : null;
}

/**
 * List the pending proposals in the owner's inbox, newest first. Reads the
 * container then each member with the owner's delegated fetch.
 */
export async function listProposals(repo: Repo): Promise<Proposal[]> {
  const authed = await getOwnerFetch(repo.ownerWebId);
  try {
    const container = inboxContainerUrl(repo);
    let members: string[];
    try {
      const ds = await getSolidDataset(container, { fetch: authed.fetch });
      members = getContainedResourceUrlAll(ds);
    } catch {
      // No inbox yet (never provisioned / 404) → no proposals.
      return [];
    }
    const out: Proposal[] = [];
    for (const memberUrl of members) {
      const id = idFromUrl(memberUrl);
      if (!id) continue; // skip the `.acl`, sub-containers, non-uuid resources
      try {
        const ds = await getSolidDataset(memberUrl, { fetch: authed.fetch });
        const thing = getThing(ds, memberUrl);
        if (!thing) continue;
        out.push({
          id,
          url: memberUrl,
          title: getStringNoLocale(thing, `${NS.dcterms}title`) ?? "(untitled)",
          body: getStringNoLocale(thing, `${NS.sioc}content`) ?? "",
          proposerWebId: getUrl(thing, `${NS.as}actor`),
          contact: getStringNoLocale(thing, `${NS.solidgit}contact`),
          createdAt: getDatetime(thing, `${NS.dcterms}created`)?.getTime() ?? null,
        });
      } catch {
        // A malformed member shouldn't sink the whole listing.
        continue;
      }
    }
    out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return out;
  } finally {
    try {
      await authed.logout();
    } catch {
      /* ignore */
    }
  }
}

/** Read a single proposal by id (owner fetch), or null if absent. */
export async function getProposal(
  repo: Repo,
  id: string,
): Promise<Proposal | null> {
  if (!UUID_RE.test(id)) return null;
  const all = await listProposals(repo);
  return all.find((p) => p.id === id) ?? null;
}

/**
 * Delete a proposal notification from the inbox (owner fetch). Used both
 * to dismiss a proposal and to consume one after it has been accepted into
 * the `.mind` tracker. Returns false if the id is malformed.
 */
export async function deleteProposal(repo: Repo, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  const authed = await getOwnerFetch(repo.ownerWebId);
  try {
    const url = `${inboxContainerUrl(repo)}${id}.ttl`;
    const res = await authed.fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      throw new Error(`DELETE ${url} failed: ${res.status} ${res.statusText}`);
    }
    return true;
  } finally {
    try {
      await authed.logout();
    } catch {
      /* ignore */
    }
  }
}
