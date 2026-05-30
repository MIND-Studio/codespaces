import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { getPullRequest } from "@/lib/registry/pulls";
import { countComments, getIssueById } from "@/lib/registry/issues";
import { repoPath } from "@/lib/git/backend";
import {
  commitsAhead,
  diffFiles,
  diffStat,
  unifiedDiff,
} from "@/lib/git/diff";
import { RelativeTime } from "@/components/relative-time";
import { renderMarkdown } from "@/lib/markdown";
import { DiffView } from "@/components/diff-view";
import { PullActions } from "./pull-actions";
import { PrPreviewCard } from "./pr-preview-card";
import { RepoTabs } from "../../repo-tabs";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string; number: string }>;
};

export default async function PullDetailPage({ params }: PageProps) {
  const { owner, repo: name, number: rawNumber } = await params;
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number <= 0) notFound();
  const repo = getRepo(owner, name);
  if (!repo) notFound();
  const pull = getPullRequest(repo.id, number);
  if (!pull) notFound();

  const bare = repoPath(repo.owner, repo.name);
  const baseRef =
    pull.status === "merged" && pull.mergeSha
      ? `${pull.mergeSha}^1`
      : pull.targetBranch;
  const headRef =
    pull.status === "merged" && pull.mergeSha
      ? pull.mergeSha
      : pull.sourceBranch;

  // Diff data is best-effort: if the source branch has been deleted
  // post-merge, we silently fall back to empty arrays so the page still
  // renders.
  const [stat, files, commits, raw] = await Promise.all([
    diffStat(bare, baseRef, headRef).catch(() => ({
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
    })),
    diffFiles(bare, baseRef, headRef).catch(() => []),
    commitsAhead(bare, baseRef, headRef).catch(() => []),
    unifiedDiff(bare, baseRef, headRef).catch(() => ({
      patch: "",
      truncated: false,
    })),
  ]);

  const bodyHtml = pull.body.trim() ? renderMarkdown(pull.body) : null;
  const linkedIssue = pull.issueId ? getIssueById(pull.issueId) : null;
  const linkedIssueComments = linkedIssue
    ? countComments(linkedIssue.id)
    : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}/pulls`} className="link">
          ← pull requests
        </Link>
      </p>

      <div className="mt-3 flex flex-col-reverse items-start gap-3 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between">
        <h1
          className="display min-w-0 break-words text-2xl sm:text-3xl"
          style={{ fontFamily: "var(--font-display)", overflowWrap: "anywhere" }}
        >
          <span className="text-[color:var(--ink-faint)]">#{pull.number}</span>{" "}
          {pull.title}
        </h1>
        <span
          className="stamp shrink-0"
          data-tone={pull.status === "merged" ? "ok" : undefined}
        >
          {pull.status}
        </span>
      </div>

      <p
        className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        <Link
          href={`/repos/${owner}/${name}/tree?ref=${encodeURIComponent(pull.sourceBranch)}`}
          className="link"
        >
          {pull.sourceBranch}
        </Link>{" "}
        →{" "}
        <Link
          href={`/repos/${owner}/${name}/tree?ref=${encodeURIComponent(pull.targetBranch)}`}
          className="link"
        >
          {pull.targetBranch}
        </Link>{" "}
        · opened <RelativeTime ts={pull.createdAt} />
        {pull.mergedAt ? (
          <>
            {" "}
            · merged <RelativeTime ts={pull.mergedAt} />
          </>
        ) : null}
        {pull.closedAt && !pull.mergedAt ? (
          <>
            {" "}
            · closed <RelativeTime ts={pull.closedAt} />
          </>
        ) : null}
        {pull.agentRunId ? <> · run #{pull.agentRunId}</> : null}
        {linkedIssue ? (
          <>
            {" "}
            · closes{" "}
            <Link
              href={`/repos/${owner}/${name}/issues/${linkedIssue.number}`}
              className="link"
            >
              #{linkedIssue.number}
            </Link>{" "}
            <span
              className="stamp"
              data-tone={linkedIssue.status === "closed" ? "ok" : undefined}
            >
              {linkedIssue.status}
            </span>
          </>
        ) : null}
      </p>

      <RepoTabs owner={owner} name={name} active="pulls" />

      <div className="mt-6 overflow-hidden rounded border border-[color:var(--ink-trace)]">
        <div
          className="flex items-center justify-between gap-3 border-b border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <span>description</span>
          <span className="text-[color:var(--ink-faint)]">
            {stat.filesChanged} files · +{stat.insertions} −{stat.deletions}
          </span>
        </div>
        <div className="bg-[color:var(--paper)] px-5 py-4">
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

      <div className="mt-6">
        <PrPreviewCard
          owner={owner}
          repo={name}
          number={pull.number}
          initialStatus={pull.previewStatus}
          initialUrl={pull.previewUrl}
          initialError={pull.previewError}
        />
      </div>

      {pull.status === "open" ? (
        <div className="mt-6">
          <PullActions owner={owner} repo={name} number={pull.number} />
        </div>
      ) : null}

      {linkedIssue ? (
        <Link
          href={`/repos/${owner}/${name}/issues/${linkedIssue.number}#comments`}
          className="mt-6 flex items-center justify-between gap-3 rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-4 py-3 hover:border-[color:var(--accent)] hover:bg-[color:var(--paper)]"
        >
          <span className="min-w-0">
            <span
              className="block text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              // discussion
            </span>
            <span className="mt-0.5 block text-sm text-[color:var(--ink)]">
              {linkedIssueComments === 0
                ? "Start the discussion on the issue"
                : `${linkedIssueComments} comment${linkedIssueComments === 1 ? "" : "s"} on issue #${linkedIssue.number}`}
            </span>
          </span>
          <span
            className="shrink-0 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            open thread →
          </span>
        </Link>
      ) : null}

      <section className="mt-10">
        <h2
          className="border-b border-[color:var(--ink-trace)] pb-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Commits · {commits.length}
        </h2>
        {commits.length === 0 ? (
          <p className="mt-4 text-sm italic text-[color:var(--ink-faint)]">
            No commits visible (source branch may have been deleted).
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[color:var(--ink-trace)] border border-[color:var(--ink-trace)] rounded">
            {commits.map((c) => (
              <li
                key={c.sha}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2"
                style={{ fontFamily: "var(--font-mono-src)", fontSize: "0.8125rem" }}
              >
                <code className="text-[color:var(--ink-faint)]">{c.shortSha}</code>
                <span className="truncate text-[color:var(--ink)]">{c.subject}</span>
                <span className="hidden text-[color:var(--ink-faint)] text-[11px] sm:inline">
                  {c.author}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2
          className="border-b border-[color:var(--ink-trace)] pb-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Files · {files.length}
        </h2>
        {files.length === 0 ? (
          <p className="mt-4 text-sm italic text-[color:var(--ink-faint)]">
            No file diffs available.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[color:var(--ink-trace)] border border-[color:var(--ink-trace)] rounded">
            {files.map((f, i) => (
              <li
                key={i}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2"
                style={{ fontFamily: "var(--font-mono-src)", fontSize: "0.8125rem" }}
              >
                <span className="text-[color:var(--ink-faint)]">{f.status}</span>
                <span className="text-[color:var(--ink)] truncate">
                  {f.oldPath && f.oldPath !== f.newPath
                    ? `${f.oldPath} → ${f.newPath}`
                    : f.newPath}
                </span>
                <span className="whitespace-nowrap text-[10px]">
                  <span className="text-[color:var(--status-ok)]">+{f.insertions}</span>{" "}
                  <span className="text-[color:var(--status-bad)]">−{f.deletions}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {raw.patch ? (
        <section className="mt-10">
          <h2
            className="border-b border-[color:var(--ink-trace)] pb-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Unified diff{raw.truncated ? " · truncated" : ""}
          </h2>
          <div className="mt-4">
            <DiffView patch={raw.patch} truncated={raw.truncated} />
          </div>
        </section>
      ) : null}
    </div>
  );
}
