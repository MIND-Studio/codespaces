import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { groupByEpic } from "@/lib/tracker/read";
import { readRepoTracker } from "@/lib/tracker/source";
import type { Tracker, TrackerIssue } from "@/lib/tracker/read";
import { RelativeTime } from "@/components/relative-time";
import { RepoTabs } from "../repo-tabs";

export const dynamic = "force-dynamic";

type StatusFilter = "open" | "closed" | "all";

type PageProps = {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ status?: string }>;
};

export default async function IssuesListPage({
  params,
  searchParams,
}: PageProps) {
  const { owner, repo: name } = await params;
  const { status: statusParam } = await searchParams;
  const repo = getRepo(owner, name);
  if (!repo) notFound();

  const status: StatusFilter =
    statusParam === "closed" || statusParam === "all" ? statusParam : "open";

  const tracker = await readRepoTracker(repo, owner, name);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}`} className="link">
          ← {owner}/{name}
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-4">
        <h1
          className="display text-3xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Issues
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          {repo.proposalsEnabled ? (
            <ProposeLink owner={owner} repo={name} />
          ) : null}
          {tracker !== null ? <NewIssueLink owner={owner} repo={name} /> : null}
        </div>
      </div>

      <RepoTabs owner={owner} name={name} active="issues" />

      {tracker === null ? (
        <NoTrackerState />
      ) : (
        <TrackerBoard owner={owner} repo={name} tracker={tracker} status={status} />
      )}
    </div>
  );
}

function NewIssueLink({ owner, repo }: { owner: string; repo: string }) {
  // Mint a fresh collaborative-draft room; the composer decides issue vs epic.
  // Share the resulting URL to co-write it with someone.
  const draftId = randomUUID().slice(0, 8);
  return (
    <Link
      href={`/repos/${owner}/${repo}/issues/draft/${draftId}`}
      className="inline-block rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-1.5 text-sm text-[color:var(--paper)] hover:bg-[color:var(--accent-deep)]"
    >
      New draft
    </Link>
  );
}

function ProposeLink({ owner, repo }: { owner: string; repo: string }) {
  // Public — anyone (incl. logged-out) can propose; it lands in the owner's
  // pod inbox for triage rather than going straight onto the board.
  return (
    <Link
      href={`/repos/${owner}/${repo}/issues/propose`}
      className="inline-block rounded border border-[color:var(--ink-trace)] px-3 py-1.5 text-sm text-[color:var(--ink-soft)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent-deep)]"
    >
      Propose
    </Link>
  );
}

function TrackerBoard({
  owner,
  repo,
  tracker,
  status,
}: {
  owner: string;
  repo: string;
  tracker: Tracker;
  status: StatusFilter;
}) {
  const openCount = tracker.issues.filter((i) => i.open).length;
  const closedCount = tracker.issues.length - openCount;
  const filtered = tracker.issues.filter((i) =>
    status === "all" ? true : status === "open" ? i.open : !i.open,
  );
  const groups = groupByEpic(tracker, filtered);

  return (
    <>
      <FilterBar
        owner={owner}
        repo={repo}
        current={status}
        openCount={openCount}
        closedCount={closedCount}
      />

      {groups.length === 0 ? (
        <EmptyFilterState status={status} />
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((group) => {
            const key =
              group.kind === "epic" ? `epic:${group.epic.slug}` : "general";
            return (
              <details key={key} className="group" open>
                <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                  <span
                    aria-hidden
                    className="text-[color:var(--ink-faint)] transition-transform group-open:rotate-90"
                  >
                    ▸
                  </span>
                  {group.kind === "epic" ? (
                    <EpicHeader
                      title={group.epic.title}
                      number={group.epic.number}
                      epicStatus={group.epic.status}
                      count={group.issues.length}
                    />
                  ) : (
                    <EpicHeader title="General" count={group.issues.length} />
                  )}
                </summary>
                {group.issues.length === 0 ? (
                  <p className="mt-2 border-y border-[color:var(--ink-trace)] px-3 py-4 text-sm text-[color:var(--ink-faint)]">
                    No issues in this epic yet.
                  </p>
                ) : (
                  <ul className="mt-2 border-y border-[color:var(--ink-trace)]">
                    {group.issues.map((issue, i) => (
                      <li
                        key={issue.id}
                        className={
                          i > 0
                            ? "border-t border-[color:var(--ink-trace)]"
                            : undefined
                        }
                      >
                        <IssueRow owner={owner} repo={repo} issue={issue} />
                      </li>
                    ))}
                  </ul>
                )}
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}

function EpicHeader({
  title,
  number,
  epicStatus,
  count,
}: {
  title: string;
  number?: number;
  epicStatus?: string;
  count: number;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2
        className="display text-xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {number !== undefined ? (
          <span className="text-[color:var(--ink-faint)]">Epic {number} · </span>
        ) : null}
        {title}
      </h2>
      {epicStatus ? (
        <span
          className="stamp"
          data-tone={epicStatus === "done" ? "ok" : undefined}
        >
          {epicStatus}
        </span>
      ) : null}
      <span
        className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {count} {count === 1 ? "issue" : "issues"}
      </span>
    </div>
  );
}

function FilterBar({
  owner,
  repo,
  current,
  openCount,
  closedCount,
}: {
  owner: string;
  repo: string;
  current: StatusFilter;
  openCount: number;
  closedCount: number;
}) {
  const items: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: "open", label: "Open", count: openCount },
    { key: "closed", label: "Closed", count: closedCount },
    { key: "all", label: "All", count: openCount + closedCount },
  ];
  return (
    <nav
      className="mt-5 flex flex-wrap items-center gap-2 border-y border-[color:var(--ink-trace)] py-2 text-[11px] uppercase tracking-[0.18em]"
      style={{ fontFamily: "var(--font-mono-src)" }}
      aria-label="Filter issues by status"
    >
      {items.map((item) => {
        const isCurrent = item.key === current;
        const href = `/repos/${owner}/${repo}/issues${
          item.key === "open" ? "" : `?status=${item.key}`
        }`;
        return (
          <Link
            key={item.key}
            href={href}
            aria-current={isCurrent ? "page" : undefined}
            className="rounded-full border px-3 py-1 transition-colors"
            style={{
              borderColor: isCurrent ? "var(--accent)" : "var(--ink-trace)",
              background: isCurrent
                ? "color-mix(in srgb, var(--accent) 14%, transparent)"
                : "transparent",
              color: isCurrent ? "var(--accent-deep)" : "var(--ink-soft)",
            }}
          >
            {item.label}{" "}
            <span
              style={{
                color: isCurrent ? "var(--accent-deep)" : "var(--ink-faint)",
              }}
            >
              {item.count}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

function IssueRow({
  owner,
  repo,
  issue,
}: {
  owner: string;
  repo: string;
  issue: TrackerIssue;
}) {
  const isBlocked = issue.stateId === "Blocked" || issue.blockedBy.length > 0;
  const excerpt = makeExcerpt(issue.description ?? "");
  const modifiedTs = issue.modified ? Date.parse(issue.modified) : NaN;
  // The fold emits day-resolution xsd:date values; rendering those as a
  // relative time reads as "21h ago" for an issue minted a minute ago.
  const modifiedDateOnly =
    issue.modified && /^\d{4}-\d{2}-\d{2}$/.test(issue.modified)
      ? issue.modified
      : null;
  return (
    <Link
      href={`/repos/${owner}/${repo}/issues/${issue.number}`}
      className="block px-3 py-4 hover:bg-[color:var(--paper-soft)]"
      style={{
        borderLeft: isBlocked
          ? "2px solid var(--accent)"
          : "2px solid transparent",
      }}
    >
      <div className="flex items-start gap-4">
        {/* Status lane — fills the column under the badge so titles align and
            the metadata isn't crammed against the description. */}
        <div className="flex shrink-0 flex-col gap-2" style={{ width: "11rem" }}>
          <span
            className="stamp block whitespace-nowrap text-center"
            data-tone={issue.open ? undefined : "ok"}
          >
            {issue.stateLabel ?? (issue.open ? "open" : "closed")}
          </span>
          {issue.categoryLabel || issue.afk ? (
            <div className="flex flex-wrap gap-1.5">
              {issue.categoryLabel ? <Chip label={issue.categoryLabel} /> : null}
              {issue.afk ? <Chip label="afk" /> : null}
            </div>
          ) : null}
          <div
            className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {modifiedDateOnly ? (
              <span>updated {modifiedDateOnly}</span>
            ) : Number.isFinite(modifiedTs) ? (
              <span>
                updated <RelativeTime ts={modifiedTs} />
              </span>
            ) : null}
            {issue.blocks.length > 0 ? (
              <span>blocks {issue.blocks.length}</span>
            ) : null}
            {issue.blockedBy.length > 0 ? (
              <span style={{ color: "var(--accent-deep)" }}>
                blocked by {issue.blockedBy.length}
              </span>
            ) : null}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-medium leading-snug text-[color:var(--ink)]">
            <span className="text-[color:var(--ink-faint)]">#{issue.number}</span>{" "}
            {issue.title}
          </h3>
          {excerpt ? (
            <p
              className="mt-1.5 text-sm leading-relaxed text-[color:var(--ink-soft)]"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 4,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {excerpt}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em]"
      style={{
        fontFamily: "var(--font-mono-src)",
        borderColor: "var(--ink-trace)",
        background: "var(--paper-soft)",
        color: "var(--ink-soft)",
      }}
    >
      {label}
    </span>
  );
}

/**
 * First non-empty line(s) of the issue body, with markdown noise stripped
 * for inline display. The CSS clamps to two lines; this just produces a
 * clean source string so the clamp is on real text rather than fences /
 * bullets / heading hashes.
 */
function makeExcerpt(body: string): string {
  if (!body) return "";
  const cleaned = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= 240) return cleaned;
  return cleaned.slice(0, 237).trimEnd() + "…";
}

function EmptyFilterState({ status }: { status: StatusFilter }) {
  return (
    <section className="card mt-6 text-sm text-[color:var(--ink-soft)]">
      <p className="display text-xl" style={{ fontFamily: "var(--font-display)" }}>
        No {status === "all" ? "" : status} issues.
      </p>
    </section>
  );
}

function NoTrackerState() {
  return (
    <section className="card mt-6 text-sm text-[color:var(--ink-soft)]">
      <p className="display text-xl" style={{ fontFamily: "var(--font-display)" }}>
        No <code className="kbd">.mind</code> tracker in this repo.
      </p>
      <p className="mt-2">
        This dashboard renders the repo&apos;s <code className="kbd">.mind</code>{" "}
        tracker straight from the pushed git history. Author issues as markdown
        folders under <code className="kbd">.mind/issues/</code>, run{" "}
        <code className="kbd">npm run tracker:build</code>, and push{" "}
        <code className="kbd">.mind/build/&#123;tracker,epics,state&#125;.ttl</code>{" "}
        — they&apos;ll appear here, grouped by epic.
      </p>
    </section>
  );
}
