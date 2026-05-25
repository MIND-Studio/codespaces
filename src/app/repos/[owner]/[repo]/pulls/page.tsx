import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { listPullRequests, type PullStatus } from "@/lib/registry/pulls";
import { RelativeTime } from "@/components/relative-time";
import { RepoTabs } from "../repo-tabs";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ status?: string }>;
};

const VALID_FILTERS = ["open", "merged", "closed", "all"] as const;

export default async function PullsPage({ params, searchParams }: PageProps) {
  const { owner, repo: name } = await params;
  const sp = await searchParams;
  const repo = getRepo(owner, name);
  if (!repo) notFound();

  const filter = (
    VALID_FILTERS.includes(sp.status as (typeof VALID_FILTERS)[number])
      ? sp.status
      : "open"
  ) as PullStatus | "all";

  const pulls = listPullRequests(repo.id, filter);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}`} className="link">
          ← {owner}/{name}
        </Link>
      </p>

      <h1
        className="display mt-3 text-3xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Pull requests
      </h1>

      <RepoTabs owner={owner} name={name} active="pulls" />

      <FilterBar owner={owner} repo={name} current={filter} />

      <div className="mt-6">
        {pulls.length === 0 ? (
          <EmptyState
            owner={owner}
            repo={name}
            defaultBranch={repo.defaultBranch}
            filter={filter}
          />
        ) : (
          <ul className="border-y border-[color:var(--ink-trace)]">
            {pulls.map((p, i) => {
              const isOpen = p.status === "open";
              const tone =
                p.status === "merged"
                  ? "ok"
                  : p.status === "closed"
                    ? undefined
                    : undefined;
              const stampStyle =
                p.status === "closed"
                  ? {
                      color: "var(--ink-faint)",
                      borderColor: "var(--ink-trace)",
                      background: "transparent",
                    }
                  : undefined;
              const excerpt = makeExcerpt(p.body);
              return (
                <li
                  key={p.id}
                  className={
                    i > 0
                      ? "border-t border-[color:var(--ink-trace)]"
                      : undefined
                  }
                >
                  <Link
                    href={`/repos/${owner}/${name}/pulls/${p.number}`}
                    className="block px-3 py-4 hover:bg-[color:var(--paper-soft)]"
                    style={{
                      borderLeft: isOpen
                        ? "2px solid var(--accent)"
                        : "2px solid transparent",
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="stamp shrink-0"
                        data-tone={tone}
                        style={stampStyle}
                      >
                        {p.status}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-base font-medium leading-snug text-[color:var(--ink)]">
                          <span className="text-[color:var(--ink-faint)]">
                            #{p.number}
                          </span>{" "}
                          {p.title}
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
                          className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
                          style={{ fontFamily: "var(--font-mono-src)" }}
                        >
                          <span>
                            <span style={{ color: "var(--ink-soft)" }}>
                              {p.sourceBranch}
                            </span>{" "}
                            →{" "}
                            <span style={{ color: "var(--ink-soft)" }}>
                              {p.targetBranch}
                            </span>
                          </span>
                          <span>
                            opened <RelativeTime ts={p.createdAt} />
                          </span>
                        </div>
                      </div>
                      <span
                        aria-hidden
                        className="self-center text-[color:var(--ink-faint)]"
                      >
                        →
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function FilterBar({
  owner,
  repo,
  current,
}: {
  owner: string;
  repo: string;
  current: PullStatus | "all";
}) {
  return (
    <nav
      className="mt-5 flex flex-wrap items-center gap-2 border-y border-[color:var(--ink-trace)] py-2 text-[11px] uppercase tracking-[0.18em]"
      style={{ fontFamily: "var(--font-mono-src)" }}
      aria-label="Filter pull requests by status"
    >
      {VALID_FILTERS.map((f) => {
        const isCurrent = f === current;
        const href = `/repos/${owner}/${repo}/pulls${
          f === "open" ? "" : `?status=${f}`
        }`;
        return (
          <Link
            key={f}
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
            {f}
          </Link>
        );
      })}
    </nav>
  );
}

function EmptyState({
  owner,
  repo,
  defaultBranch,
  filter,
}: {
  owner: string;
  repo: string;
  defaultBranch: string;
  filter: PullStatus | "all";
}) {
  // The bridge opens draft PRs automatically when the engineer agent pushes
  // a branch — there is no "file a PR by form" path here yet. The copy
  // reflects what the bridge actually does (see AGENTS.md / pulls model).
  if (filter !== "open") {
    return (
      <section className="card text-sm text-[color:var(--ink-soft)]">
        <p
          className="display text-xl text-[color:var(--ink)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Nothing {filter === "all" ? "here yet" : `${filter}`}.
        </p>
        <p className="mt-2">
          When a pull request is {filter === "all" ? "opened" : filter}, it
          will show up here.
        </p>
      </section>
    );
  }
  return (
    <section className="card text-sm text-[color:var(--ink-soft)]">
      <p
        className="display text-xl text-[color:var(--ink)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        No open pull requests.
      </p>
      <p className="mt-3 leading-relaxed">
        The <span style={{ color: "var(--ink)" }}>engineer</span> agent opens
        a draft pull request automatically when it pushes a branch in
        response to an issue labeled{" "}
        <code className="kbd">ready</code> — the PR then targets{" "}
        <code className="kbd">{defaultBranch}</code>.
      </p>
      <p className="mt-3 leading-relaxed">
        You can also push your own branch to this bridge from the command
        line; see{" "}
        <Link href={`/repos/${owner}/${repo}`} className="link">
          the repo page
        </Link>{" "}
        for the clone URL and push token.
      </p>
      <ul
        className="mt-4 space-y-1 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        <li>
          <span style={{ color: "var(--ink-soft)" }}>open</span> —
          unmerged, source branch still alive
        </li>
        <li>
          <span style={{ color: "var(--ink-soft)" }}>merged</span> —
          fast-forwarded onto {defaultBranch}
        </li>
        <li>
          <span style={{ color: "var(--ink-soft)" }}>closed</span> —
          rejected without merging
        </li>
      </ul>
    </section>
  );
}

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
