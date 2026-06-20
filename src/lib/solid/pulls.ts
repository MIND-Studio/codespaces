import "server-only";
import { getIssueById } from "@/lib/registry/issues";
import type { PullRequest } from "@/lib/registry/pulls";
import type { Repo } from "@/lib/registry/repos";
import { ensureContainer, setVisibilityAcl } from "@/lib/solid/containers";
import { getOwnerFetch } from "@/lib/solid/fetch-for-owner";
import { issueUrl } from "@/lib/solid/issues";
import { readMembersWithFetch } from "@/lib/solid/members";
import { NS } from "@/lib/vocab";

/**
 * Pod-native Pull Requests — the PR counterpart to `issues.ts`. When a PR is
 * opened on a Repo, its canonical Turtle is written into the owner's pod under
 * the delegated connection, parallel to how Issues are already mirrored (#142).
 *
 * Path layout under the owner's pod root:
 *
 *   {podRoot}/codespaces/{repo}/pulls/                 (container)
 *   {podRoot}/codespaces/{repo}/pulls/{n}/             (per-PR container)
 *   {podRoot}/codespaces/{repo}/pulls/{n}/pull.ttl     (canonical PR body)
 *
 * The `/codespaces/{repo}/` container already exists from `repo-metadata`; the
 * PR sub-containers are ensured idempotently. The `pulls/` ACL follows the
 * repo's **visibility** per ADR-0002 — public-read on public repos, owner-only
 * on private (a member `Read` grant on private repos is the membership-epic
 * (#157) follow-up). This is the same treatment `issues/` gets, except issues
 * are always public-read; PRs honour visibility because they gate that epic.
 */

function trailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function pullsContainerUrl(repo: Repo): string {
  return `${trailingSlash(repo.ownerPodRoot)}codespaces/${repo.name}/pulls/`;
}

export function pullContainerUrl(repo: Repo, number: number): string {
  return `${pullsContainerUrl(repo)}${number}/`;
}

export function pullUrl(repo: Repo, number: number): string {
  return `${pullContainerUrl(repo, number)}pull.ttl`;
}

function quote(s: string): string {
  // Triple-quoted Turtle long string — survives newlines without escaping.
  return `"""${s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')}"""`;
}

function isoDt(ms: number): string {
  return `"${new Date(ms).toISOString()}"^^xsd:dateTime`;
}

/**
 * Render the canonical Turtle for a PR. Pure (no I/O) so it round-trips in a
 * unit test. `closesIssueUrl`, when present, is the pod URL of the issue this
 * PR closes — the writer resolves it from the PR's `issueId`.
 */
export function renderPullTurtle(
  repo: Repo,
  pull: PullRequest,
  opts: { closesIssueUrl?: string } = {},
): string {
  const repoUrl = `${trailingSlash(repo.ownerPodRoot)}codespaces/${repo.name}/index.ttl#repo`;

  const lines = [
    `@prefix solidgit: <${NS.solidgit}>.`,
    `@prefix dcterms: <${NS.dcterms}>.`,
    `@prefix xsd: <${NS.xsd}>.`,
    `@prefix sioc: <${NS.sioc}>.`,
    `@prefix foaf: <${NS.foaf}>.`,
    "",
    "<#pull>",
    "    a solidgit:PullRequest, sioc:Item ;",
    `    solidgit:number "${pull.number}"^^xsd:integer ;`,
    `    solidgit:repository <${repoUrl}> ;`,
    `    dcterms:title ${JSON.stringify(pull.title)} ;`,
    `    sioc:content ${quote(pull.body)} ;`,
    `    solidgit:status "${pull.status}" ;`,
    `    solidgit:sourceBranch ${JSON.stringify(pull.sourceBranch)} ;`,
    `    solidgit:targetBranch ${JSON.stringify(pull.targetBranch)} ;`,
    `    solidgit:sourceCommit "${pull.sourceSha}" ;`,
  ];
  // Agent-authored PRs may have no creator; emit the triple only when known so
  // the Turtle stays valid (no dangling `sioc:has_creator <>`).
  if (pull.authorWebId) {
    lines.push(`    sioc:has_creator <${pull.authorWebId}> ;`);
  }
  if (opts.closesIssueUrl) {
    lines.push(`    solidgit:closesIssue <${opts.closesIssueUrl}> ;`);
  }
  lines.push(`    dcterms:created ${isoDt(pull.createdAt)} ;`);
  lines.push(`    dcterms:modified ${isoDt(pull.updatedAt)} .`);
  lines.push("");
  return lines.join("\n");
}

async function ensurePullContainers(
  fetcher: typeof fetch,
  repo: Repo,
  pullNumber: number,
): Promise<void> {
  const pullsUrl = pullsContainerUrl(repo);
  const createdPulls = await ensureContainer(fetcher, pullsUrl);
  if (createdPulls) {
    // On a private repo, the roster's members get `acl:Read` on `pulls/` too
    // (ADR-0002's #142 corollary). Read it with the fetch we already hold so a
    // member added before the first PR can still see it.
    const memberWebIds =
      repo.visibility === "private"
        ? (await readMembersWithFetch(fetcher, repo)).map((m) => m.webId)
        : [];
    await setVisibilityAcl(fetcher, pullsUrl, repo.ownerWebId, repo.visibility, memberWebIds);
  }
  await ensureContainer(fetcher, pullContainerUrl(repo, pullNumber));
}

/**
 * Write (or rewrite) the canonical Turtle for a PR on the pod. Best-effort
 * caller pattern: the route fires this and catches & logs (mirrors how issues
 * are mirrored), so a pod hiccup never blocks opening the PR.
 */
export async function writePullToPod(
  repo: Repo,
  pull: PullRequest,
): Promise<{ url: string; mode: "delegated" | "seeded" }> {
  // Resolve the linked issue's pod URL (if any) for `solidgit:closesIssue`.
  // `issueId` is a registry id; map it to the issue number this repo uses.
  let closesIssueUrl: string | undefined;
  if (pull.issueId != null) {
    const issue = getIssueById(pull.issueId);
    if (issue && issue.repoId === repo.id) {
      closesIssueUrl = issueUrl(repo, issue.number);
    }
  }

  const authed = await getOwnerFetch(repo.ownerWebId);
  try {
    await ensurePullContainers(authed.fetch, repo, pull.number);
    const url = pullUrl(repo, pull.number);
    const res = await authed.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body: renderPullTurtle(repo, pull, { closesIssueUrl }),
    });
    if (!res.ok) {
      throw new Error(`PUT ${url} failed: ${res.status} ${res.statusText}`);
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
