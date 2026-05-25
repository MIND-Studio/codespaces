import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { getIssueByNumber, listComments } from "@/lib/registry/issues";
import { listAgentRunsForIssue } from "@/lib/registry/agent-runs";
import { RelativeTime } from "@/components/relative-time";
import { renderMarkdown } from "@/lib/markdown";
import { IssueActions } from "./issue-actions";
import { CommentForm } from "./comment-form";
import { AgentRunCard } from "./agent-run-card";

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
  const issue = getIssueByNumber(repo.id, number);
  if (!issue) notFound();
  const comments = listComments(issue.id);
  const agentRuns = listAgentRunsForIssue(issue.id);

  const bodyHtml = issue.body.trim() ? renderMarkdown(issue.body) : null;

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
        <span
          className="stamp shrink-0"
          data-tone={issue.status === "open" ? undefined : "ok"}
        >
          {issue.status}
        </span>
      </div>
      <p
        className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        priority {issue.priority} · created <RelativeTime ts={issue.createdAt} />{" "}
        · updated <RelativeTime ts={issue.updatedAt} />
        {issue.labels.length > 0 ? (
          <> · {issue.labels.map((l) => `#${l}`).join(" ")}</>
        ) : null}
      </p>

      <div className="mt-6 overflow-hidden rounded border border-[color:var(--ink-trace)]">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-4 py-2">
          <span
            className="min-w-0 truncate text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            <a
              href={issue.authorWebId}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[color:var(--accent)]"
            >
              {compactWebId(issue.authorWebId)}
            </a>
          </span>
          <a
            href={issue.podUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            view turtle →
          </a>
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

      <div className="mt-6">
        <IssueActions
          owner={owner}
          repo={name}
          number={issue.number}
          status={issue.status}
          hasOpenRun={agentRuns.some(
            (r) => r.status === "running" && r.role === "coder",
          )}
        />
      </div>

      {agentRuns.length > 0 ? (
        <section className="mt-10">
          <h2
            className="border-b border-[color:var(--ink-trace)] pb-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Agent activity · {agentRuns.length}
          </h2>
          <ul className="mt-4 space-y-3">
            {agentRuns.map((run) => (
              <li key={run.id}>
                <AgentRunCard run={run} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-10">
        <h2
          className="border-b border-[color:var(--ink-trace)] pb-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Comments · {comments.length}
        </h2>
        {comments.length === 0 ? (
          <p className="mt-4 text-sm italic text-[color:var(--ink-faint)]">
            No comments yet.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {comments.map((c) => {
              const html = renderMarkdown(c.body);
              const isAgent = c.agentRunId !== null;
              return (
                <li
                  key={c.id}
                  className={
                    isAgent
                      ? "overflow-hidden rounded border border-[color:var(--accent)]/40"
                      : "overflow-hidden rounded border border-[color:var(--ink-trace)]"
                  }
                >
                  <div
                    className={
                      isAgent
                        ? "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10 px-4 py-2"
                        : "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-4 py-2"
                    }
                  >
                    <span
                      className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em]"
                      style={{ fontFamily: "var(--font-mono-src)" }}
                    >
                      {isAgent ? (
                        <>
                          <span
                            className="stamp"
                            data-tone="ok"
                          >
                            coder
                          </span>
                          <span className="text-[color:var(--ink-faint)]">
                            agent · run #{c.agentRunId}
                          </span>
                        </>
                      ) : (
                        <a
                          href={c.authorWebId}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
                        >
                          {compactWebId(c.authorWebId)}
                        </a>
                      )}
                      <span className="text-[color:var(--ink-faint)]">
                        · <RelativeTime ts={c.createdAt} />
                      </span>
                    </span>
                    {isAgent ? null : (
                      <a
                        href={c.podUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
                        style={{ fontFamily: "var(--font-mono-src)" }}
                      >
                        turtle →
                      </a>
                    )}
                  </div>
                  <div className="bg-[color:var(--paper)] px-4 py-4 sm:px-5">
                    <article
                      className="markdown-body"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-6">
          <CommentForm owner={owner} repo={name} number={issue.number} />
        </div>
      </section>
    </div>
  );
}

function compactWebId(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.hash}`;
  } catch {
    return url;
  }
}

