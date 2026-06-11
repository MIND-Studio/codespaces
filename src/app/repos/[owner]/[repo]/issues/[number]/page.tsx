import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { repoPath } from "@/lib/git/backend";
import { readGitTracker } from "@/lib/tracker/read";
import type { Tracker, TrackerIssue } from "@/lib/tracker/read";
import { RelativeTime } from "@/components/relative-time";
import { renderMarkdown } from "@/lib/markdown";
import { RepoTabs } from "../../repo-tabs";
import { Avatar, deriveLabel } from "@/components/avatar";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string; number: string }>;
};

export default async function IssueDetailPage({ params }: PageProps) {
  const { owner, repo: name, number: rawNumber } = await params;
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number <= 0) notFound();

  const repo = getRepo(owner, name);
  if (!repo) notFound();

  const tracker = await readGitTracker(repoPath(repo.owner, repo.name), owner, name);
  if (!tracker) notFound();
  const issue = tracker.issues.find((i) => i.number === number);
  if (!issue) notFound();

  const bodyHtml = issue.description?.trim()
    ? renderMarkdown(issue.description)
    : null;
  const epic = issue.epicSlug
    ? tracker.epics.find((e) => e.slug === issue.epicSlug)
    : undefined;
  const createdTs = issue.created ? Date.parse(issue.created) : NaN;
  const modifiedTs = issue.modified ? Date.parse(issue.modified) : NaN;
  // The fold emits day-resolution xsd:date values; a relative time off a
  // bare date reads as "21h ago" for an issue minted a minute ago.
  const dateOnly = (v: string | undefined) =>
    v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  const createdDate = dateOnly(issue.created);
  const modifiedDate = dateOnly(issue.modified);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}/issues`} className="link">
          ← issues
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <h1
          className="display break-words text-2xl sm:text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          <span className="text-[color:var(--ink-faint)]">#{issue.number}</span>{" "}
          {issue.title}
        </h1>
        <span className="stamp shrink-0" data-tone={issue.open ? undefined : "ok"}>
          {issue.stateLabel ?? (issue.open ? "open" : "closed")}
        </span>
      </div>
      <p
        className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {issue.categoryLabel ? <span>{issue.categoryLabel}</span> : null}
        {epic ? (
          <span>
            epic{" "}
            <Link
              href={`/repos/${owner}/${name}/issues`}
              className="hover:text-[color:var(--accent)]"
            >
              {epic.title}
            </Link>
          </span>
        ) : null}
        {createdDate ? (
          <span>created {createdDate}</span>
        ) : Number.isFinite(createdTs) ? (
          <span>
            created <RelativeTime ts={createdTs} />
          </span>
        ) : null}
        {modifiedDate ? (
          <span>updated {modifiedDate}</span>
        ) : Number.isFinite(modifiedTs) ? (
          <span>
            updated <RelativeTime ts={modifiedTs} />
          </span>
        ) : null}
        {issue.afk ? <span>afk</span> : null}
      </p>

      <RepoTabs owner={owner} name={name} active="issues" />

      <Dependencies owner={owner} repo={name} tracker={tracker} issue={issue} />

      <div className="mt-6 overflow-hidden rounded border border-[color:var(--ink-trace)]">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-4 py-2">
          {issue.assignee ? (
            <Assignee webId={issue.assignee} />
          ) : (
            <span
              className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              unassigned
            </span>
          )}
          <span
            className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
            title="canonical .mind issue id"
          >
            {issue.id}
          </span>
        </div>
        <div className="bg-[color:var(--paper)] px-4 py-4 sm:px-5">
          {bodyHtml ? (
            <article
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          ) : (
            <p className="text-sm italic text-[color:var(--ink-faint)]">
              (no description)
            </p>
          )}
        </div>
      </div>

      <p
        className="mt-6 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        Read-only · folded from this repo&apos;s{" "}
        <code className="kbd">.mind</code> tracker. Edit by authoring events under{" "}
        <code className="kbd">.mind/issues/</code> and pushing.
      </p>
    </div>
  );
}

function Assignee({ webId }: { webId: string }) {
  const { handle } = deriveLabel(webId);
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Avatar webId={webId} size="md" />
      <span className="min-w-0">
        <a
          href={webId}
          target="_blank"
          rel="noreferrer"
          className="block truncate text-sm text-[color:var(--ink)] hover:text-[color:var(--accent)]"
          title={webId}
        >
          <strong className="font-semibold">{handle}</strong>
        </a>
        <span
          className="block text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          assignee
        </span>
      </span>
    </span>
  );
}

/** Renders blocks / blockedBy as links, resolving ULIDs → #number when known. */
function Dependencies({
  owner,
  repo,
  tracker,
  issue,
}: {
  owner: string;
  repo: string;
  tracker: Tracker;
  issue: TrackerIssue;
}) {
  if (issue.blocks.length === 0 && issue.blockedBy.length === 0) return null;
  const byId = new Map(tracker.issues.map((i) => [i.id, i]));

  const render = (label: string, ids: string[], tone?: string) => (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      <span className="text-[color:var(--ink-faint)]" style={{ color: tone }}>
        {label}
      </span>
      {ids.map((id) => {
        const target = byId.get(id);
        return target?.number !== undefined ? (
          <Link
            key={id}
            href={`/repos/${owner}/${repo}/issues/${target.number}`}
            className="hover:text-[color:var(--accent)]"
            title={target.title}
          >
            #{target.number}
          </Link>
        ) : (
          <span key={id} title={id}>
            {id.slice(-4)}
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="mt-4 space-y-1">
      {issue.blockedBy.length > 0
        ? render("blocked by", issue.blockedBy, "var(--accent-deep)")
        : null}
      {issue.blocks.length > 0 ? render("blocks", issue.blocks) : null}
    </div>
  );
}
