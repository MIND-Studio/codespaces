import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { getIssueByNumber, listComments } from "@/lib/registry/issues";
import { listAgentRunsForIssue } from "@/lib/registry/agent-runs";
import { listPullRequestsForIssue } from "@/lib/registry/pulls";
import { RelativeTime } from "@/components/relative-time";
import { renderMarkdown } from "@/lib/markdown";
import { IssueActions } from "./issue-actions";
import { CommentForm } from "./comment-form";
import { AgentRunCard } from "./agent-run-card";
import { RepoTabs } from "../../repo-tabs";
import { Avatar, deriveLabel } from "@/components/avatar";
import { SignInWall } from "@/components/sign-in-wall";
import { readSession } from "@/lib/auth/session";

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
  const linkedPulls = listPullRequestsForIssue(issue.id);
  const session = await readSession();
  const returnTo = `/repos/${owner}/${name}/issues/${number}`;

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

      <RepoTabs owner={owner} name={name} active="issues" />

      {linkedPulls.length > 0 ? (
        <div
          className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <span className="text-[color:var(--ink-faint)]">linked pulls</span>
          {linkedPulls.map((p) => (
            <Link
              key={p.id}
              href={`/repos/${owner}/${name}/pulls/${p.number}`}
              className="inline-flex items-center gap-1.5 hover:text-[color:var(--accent)]"
              title={p.title}
            >
              <span
                className="stamp"
                data-tone={
                  p.status === "merged"
                    ? "ok"
                    : p.status === "closed"
                      ? "bad"
                      : undefined
                }
              >
                {p.status}
              </span>
              <span>#{p.number}</span>
            </Link>
          ))}
        </div>
      ) : null}

      <CommentCard
        author={{ webId: issue.authorWebId, agentRunId: null }}
        createdAt={issue.createdAt}
        podUrl={issue.podUrl}
        bodyHtml={bodyHtml}
        opener
      />

      {session ? (
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
      ) : null}

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
              <li key={run.id} id={`agent-run-${run.id}`} className="scroll-mt-20">
                <AgentRunCard run={run} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section id="comments" className="mt-10 scroll-mt-20">
        <h2
          className="border-b border-[color:var(--ink-trace)] pb-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Comments · {comments.length}
        </h2>
        {comments.length === 0 ? (
          <p
            className="mt-4 rounded border border-dashed border-[color:var(--ink-trace)] px-4 py-6 text-center text-sm italic text-[color:var(--ink-faint)]"
          >
            No comments yet. Start the conversation below — the coder agent
            re-fires on every new comment.
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {comments.map((c) => (
              <li key={c.id} id={`comment-${c.id}`} className="scroll-mt-20">
                <CommentCard
                  author={{ webId: c.authorWebId, agentRunId: c.agentRunId }}
                  createdAt={c.createdAt}
                  podUrl={c.podUrl}
                  bodyHtml={renderMarkdown(c.body)}
                />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6">
          {session ? (
            <CommentForm owner={owner} repo={name} number={issue.number} />
          ) : (
            <SignInWall
              action="leave a comment or close this issue"
              next={`${returnTo}#comments`}
            />
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Renders one entry in the issue thread: the original issue body
 * (`opener`) or a follow-up comment. Agent comments get a distinct
 * border + "coder" avatar and a deep-link to the corresponding agent
 * run card on the same page.
 */
function CommentCard({
  author,
  createdAt,
  podUrl,
  bodyHtml,
  opener,
}: {
  author: { webId: string; agentRunId: number | null };
  createdAt: number;
  podUrl: string;
  bodyHtml: string | null;
  opener?: boolean;
}) {
  const isAgent = author.agentRunId !== null;
  const { handle } = deriveLabel(author.webId);

  return (
    <div
      className={`overflow-hidden rounded border ${
        isAgent
          ? "border-[color:var(--accent)]/40"
          : "border-[color:var(--ink-trace)]"
      }`}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2 ${
          isAgent
            ? "border-[color:var(--accent)]/30 bg-[color:var(--accent)]/10"
            : "border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)]"
        }`}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Avatar webId={author.webId} agent={isAgent} size="md" />
          <span className="min-w-0">
            {isAgent ? (
              <span className="block text-sm text-[color:var(--ink)]">
                <strong className="font-semibold">coder</strong>{" "}
                <a
                  href={`#agent-run-${author.agentRunId}`}
                  className="text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
                  style={{ fontFamily: "var(--font-mono-src)" }}
                  title="jump to agent run on this page"
                >
                  · run #{author.agentRunId} ↑
                </a>
              </span>
            ) : (
              <a
                href={author.webId}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm text-[color:var(--ink)] hover:text-[color:var(--accent)]"
                title={author.webId}
              >
                <strong className="font-semibold">{handle}</strong>
              </a>
            )}
            <span
              className="block text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              {opener ? "opened " : "commented "}
              <RelativeTime ts={createdAt} />
            </span>
          </span>
        </span>
        {!isAgent && podUrl ? (
          <a
            href={podUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
            title="view the source Turtle in the pod"
          >
            turtle →
          </a>
        ) : null}
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
  );
}

