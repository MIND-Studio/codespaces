import "server-only";
import type { Issue, IssueComment } from "@/lib/registry/issues";
import type { Repo } from "@/lib/registry/repos";
import { ensureContainer, setPublicReadAcl } from "@/lib/solid/containers";
import { getOwnerFetch } from "@/lib/solid/fetch-for-owner";
import { NS } from "@/lib/vocab";

/**
 * Path layout under the owner's pod root:
 *
 *   {podRoot}/codespaces/{repo}/issues/                  (container)
 *   {podRoot}/codespaces/{repo}/issues/{n}/              (per-issue container)
 *   {podRoot}/codespaces/{repo}/issues/{n}/issue.ttl     (canonical issue body)
 *   {podRoot}/codespaces/{repo}/issues/{n}/comments/     (comments container)
 *   {podRoot}/codespaces/{repo}/issues/{n}/comments/{cid}.ttl
 *
 * The `/codespaces/{repo}/` container already exists from `repo-metadata`;
 * we ensure the issue sub-containers idempotently. Public-read ACL is set
 * on `/issues/` (issues are world-readable artifacts; the repo determines
 * visibility but issues sit alongside the public Turtle metadata).
 */

function trailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

export function issuesContainerUrl(repo: Repo): string {
  return `${trailingSlash(repo.ownerPodRoot)}codespaces/${repo.name}/issues/`;
}

export function issueContainerUrl(repo: Repo, number: number): string {
  return `${issuesContainerUrl(repo)}${number}/`;
}

export function issueUrl(repo: Repo, number: number): string {
  return `${issueContainerUrl(repo, number)}issue.ttl`;
}

export function commentsContainerUrl(repo: Repo, number: number): string {
  return `${issueContainerUrl(repo, number)}comments/`;
}

export function commentUrl(repo: Repo, issueNumber: number, commentId: number): string {
  return `${commentsContainerUrl(repo, issueNumber)}${commentId}.ttl`;
}

function quote(s: string): string {
  // Triple-quoted Turtle long string — survives newlines without escaping.
  return `"""${s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"')}"""`;
}

function isoDt(ms: number): string {
  return `"${new Date(ms).toISOString()}"^^xsd:dateTime`;
}

function renderIssueTurtle(repo: Repo, issue: Issue): string {
  const repoUrl = `${trailingSlash(repo.ownerPodRoot)}codespaces/${repo.name}/index.ttl#repo`;
  const labels = issue.labels.map((l) => `"${l.replace(/"/g, '\\"')}"`).join(", ");

  const lines = [
    `@prefix solidgit: <${NS.solidgit}>.`,
    `@prefix dcterms: <${NS.dcterms}>.`,
    `@prefix xsd: <${NS.xsd}>.`,
    `@prefix sioc: <${NS.sioc}>.`,
    `@prefix foaf: <${NS.foaf}>.`,
    "",
    "<#issue>",
    "    a solidgit:Issue, sioc:Item ;",
    `    solidgit:number "${issue.number}"^^xsd:integer ;`,
    `    solidgit:repository <${repoUrl}> ;`,
    `    dcterms:title ${JSON.stringify(issue.title)} ;`,
    `    sioc:content ${quote(issue.body)} ;`,
    `    solidgit:status "${issue.status}" ;`,
    `    solidgit:priority "${issue.priority}" ;`,
    `    sioc:has_creator <${issue.authorWebId}> ;`,
    `    dcterms:created ${isoDt(issue.createdAt)} ;`,
    `    dcterms:modified ${isoDt(issue.updatedAt)}`,
  ];
  if (labels) {
    lines[lines.length - 1] += " ;";
    lines.push(`    solidgit:label ${labels}`);
  }
  lines[lines.length - 1] += " .";
  lines.push("");
  return lines.join("\n");
}

function renderCommentTurtle(repo: Repo, issueNumber: number, comment: IssueComment): string {
  const parent = `${issueContainerUrl(repo, issueNumber)}issue.ttl#issue`;
  return `@prefix solidgit: <${NS.solidgit}>.
@prefix dcterms: <${NS.dcterms}>.
@prefix xsd: <${NS.xsd}>.
@prefix sioc: <${NS.sioc}>.
@prefix foaf: <${NS.foaf}>.

<#comment>
    a solidgit:Comment, sioc:Post ;
    sioc:reply_of <${parent}> ;
    sioc:has_creator <${comment.authorWebId}> ;
    sioc:content ${quote(comment.body)} ;
    dcterms:created ${isoDt(comment.createdAt)} .
`;
}

async function ensureIssueContainers(
  fetcher: typeof fetch,
  repo: Repo,
  issueNumber: number,
): Promise<void> {
  const issuesUrl = issuesContainerUrl(repo);
  const createdIssues = await ensureContainer(fetcher, issuesUrl);
  if (createdIssues) {
    await setPublicReadAcl(fetcher, issuesUrl, repo.ownerWebId);
  }
  await ensureContainer(fetcher, issueContainerUrl(repo, issueNumber));
  await ensureContainer(fetcher, commentsContainerUrl(repo, issueNumber));
}

/**
 * Write (or rewrite) the canonical Turtle for an issue on the pod.
 * Best-effort caller pattern: caller catches & logs.
 */
export async function writeIssueToPod(
  repo: Repo,
  issue: Issue,
): Promise<{ url: string; mode: "delegated" | "seeded" }> {
  const authed = await getOwnerFetch(repo.ownerWebId);
  try {
    await ensureIssueContainers(authed.fetch, repo, issue.number);
    const url = issueUrl(repo, issue.number);
    const res = await authed.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body: renderIssueTurtle(repo, issue),
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

export async function writeCommentToPod(
  repo: Repo,
  issueNumber: number,
  comment: IssueComment,
): Promise<{ url: string; mode: "delegated" | "seeded" }> {
  const authed = await getOwnerFetch(repo.ownerWebId);
  try {
    await ensureIssueContainers(authed.fetch, repo, issueNumber);
    const url = commentUrl(repo, issueNumber, comment.id);
    const res = await authed.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body: renderCommentTurtle(repo, issueNumber, comment),
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
