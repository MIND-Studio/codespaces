import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import {
  countIssuesByStatus,
  listIssues,
  type Issue,
  type IssueStatus,
} from "@/lib/registry/issues";
import { RelativeTime } from "@/components/relative-time";

export const dynamic = "force-dynamic";

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

  const status: IssueStatus | "all" =
    statusParam === "closed" || statusParam === "all" ? statusParam : "open";

  const counts = countIssuesByStatus(repo.id);
  const issues = listIssues(repo.id, { status });

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
        <NewIssueLink owner={owner} repo={name} />
      </div>

      <FilterBar
        owner={owner}
        repo={name}
        current={status}
        openCount={counts.open}
        closedCount={counts.closed}
      />

      {issues.length === 0 ? (
        <EmptyState status={status} />
      ) : (
        <ul className="mt-4 border-y border-[color:var(--ink-trace)]">
          {issues.map((issue, i) => (
            <li
              key={issue.id}
              className={
                i > 0 ? "border-t border-[color:var(--ink-trace)]" : undefined
              }
            >
              <IssueRow owner={owner} repo={name} issue={issue} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewIssueLink({ owner, repo }: { owner: string; repo: string }) {
  return (
    <Link
      href={`/repos/${owner}/${repo}/issues/new`}
      className="inline-block rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-1.5 text-sm text-[color:var(--paper)] hover:bg-[color:var(--accent-deep)]"
    >
      New issue
    </Link>
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
  current: IssueStatus | "all";
  openCount: number;
  closedCount: number;
}) {
  const items: Array<{ key: IssueStatus | "all"; label: string; count: number }> = [
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
              color: isCurrent
                ? "var(--accent-deep)"
                : "var(--ink-soft)",
            }}
          >
            {item.label}{" "}
            <span
              style={{
                color: isCurrent
                  ? "var(--accent-deep)"
                  : "var(--ink-faint)",
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
  issue: Issue;
}) {
  const isOpen = issue.status === "open";
  const isUrgent = isOpen && issue.priority === "high";
  const excerpt = makeExcerpt(issue.body);
  return (
    <Link
      href={`/repos/${owner}/${repo}/issues/${issue.number}`}
      className="block px-3 py-4 hover:bg-[color:var(--paper-soft)]"
      style={
        isUrgent
          ? { borderLeft: "2px solid var(--accent)" }
          : { borderLeft: "2px solid transparent" }
      }
    >
      <div className="flex items-start gap-3">
        <span
          className="stamp shrink-0"
          data-tone={isOpen ? undefined : "ok"}
          style={
            isOpen
              ? undefined
              : {
                  color: "var(--ink-faint)",
                  borderColor: "var(--ink-trace)",
                  background: "transparent",
                }
          }
        >
          {issue.status}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-medium leading-snug text-[color:var(--ink)]">
            <span className="text-[color:var(--ink-faint)]">
              #{issue.number}
            </span>{" "}
            {issue.title}
          </h2>
          {excerpt ? (
            <p
              className="mt-1 text-sm text-[color:var(--ink-soft)]"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {excerpt}
            </p>
          ) : null}
          <div
            className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            <span>
              updated <RelativeTime ts={issue.updatedAt} />
            </span>
            <span>
              priority{" "}
              <span
                style={{
                  color: isUrgent
                    ? "var(--accent-deep)"
                    : "var(--ink-soft)",
                }}
              >
                {issue.priority}
              </span>
            </span>
          </div>
        </div>
        {issue.labels.length > 0 ? (
          <div className="hidden shrink-0 flex-wrap items-center justify-end gap-1.5 pt-0.5 sm:flex sm:max-w-[40%]">
            {issue.labels.map((l) => (
              <LabelChip key={l} label={l} />
            ))}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

function LabelChip({ label }: { label: string }) {
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

function EmptyState({ status }: { status: IssueStatus | "all" }) {
  return (
    <section className="card mt-6 text-sm text-[color:var(--ink-soft)]">
      <p
        className="display text-xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        No {status === "all" ? "" : status} issues.
      </p>
      <p className="mt-2">
        Issues live in the owner&apos;s pod under{" "}
        <code className="kbd">/codespaces/{`{repo}`}/issues/</code> as Turtle
        documents. The dashboard reads them from the registry index, which
        mirrors the pod.
      </p>
    </section>
  );
}
