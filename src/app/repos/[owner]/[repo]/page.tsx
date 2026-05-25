import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo, getPagesConfig } from "@/lib/registry/repos";
import { countIssuesByStatus } from "@/lib/registry/issues";
import { countOpenPullRequests } from "@/lib/registry/pulls";
import { listPushTokens } from "@/lib/registry/tokens";
import {
  getLatestRunForRepo,
  listRunsForRepo,
  type WorkflowRun,
} from "@/lib/registry/runs";
import { isOrg } from "@/lib/registry/owners";
import { repoPath } from "@/lib/git/backend";
import { findReadme, hasAnyCommits } from "@/lib/git/objects";
import { renderMarkdown } from "@/lib/markdown";
import { RelativeTime } from "@/components/relative-time";
import { CopyButton } from "@/components/copy-button";
import { formatDuration } from "@/lib/format";
import { TokenManager } from "./token-manager";
import { RerunButton } from "./rerun-button";
import { NavTabs } from "./nav-tabs";
import { readSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function RepoDetailPage({ params }: PageProps) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) notFound();
  const pages = getPagesConfig(repo.id);
  const tokens = listPushTokens(repo.id);
  const bridgeBase = process.env.BRIDGE_PUBLIC_URL ?? "http://localhost:3010";
  const cloneUrl = `${bridgeBase}/api/git/${repo.owner}/${repo.name}.git`;
  const publishedUrl =
    pages?.enabled && pages.targetContainer
      ? `${pages.targetContainer}${pages.targetContainer.endsWith("/") ? "" : "/"}index.html`
      : null;

  const bare = repoPath(repo.owner, repo.name);
  const readme = (await hasAnyCommits(bare))
    ? await findReadme(bare, repo.defaultBranch)
    : null;
  const readmeHtml = readme ? renderMarkdown(readme.content) : null;

  // Pull the 5 most recent runs: index 0 is the "latest build" panel,
  // indices 1..4 fill the compact "previous runs" mini-list below.
  const recentRuns = listRunsForRepo(repo.id, 5);
  const latestRun = recentRuns[0] ?? null;
  const previousRuns = recentRuns.slice(1);
  const runCount = getRunCount(repo.id);
  const issueCounts = countIssuesByStatus(repo.id);
  const openPullCount = countOpenPullRequests(repo.id);
  const session = await readSession();
  const isOwner = session?.webId === repo.ownerWebId;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-10 sm:py-12">
      <Header
        repo={repo}
        latestRun={latestRun}
        publishedUrl={publishedUrl}
        pages={pages}
        runCount={runCount}
        openIssueCount={issueCounts.open}
        openPullCount={openPullCount}
        owner={owner}
        name={name}
        isOwner={isOwner}
      />

      <PublishStatusBanner pages={pages} />

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-12">
        <main className="min-w-0 space-y-10">
          {readmeHtml && readme ? (
            <ReadmeSection
              owner={owner}
              name={name}
              readmeName={readme.name}
              readmeHtml={readmeHtml}
            />
          ) : (
            <EmptyReadme owner={owner} name={name} hasCommits={readme !== null || (await hasAnyCommits(bare))} />
          )}

          {latestRun ? (
            <LatestBuildSection
              latestRun={latestRun}
              previousRuns={previousRuns}
              owner={owner}
              repoName={name}
              totalRuns={runCount}
            />
          ) : (
            <NoBuildsHint />
          )}
        </main>

        <aside className="space-y-8 lg:border-l lg:border-[color:var(--ink-trace)] lg:pl-8">
          <SidebarSection title="Clone URL">
            <CloneUrlBlock url={cloneUrl} />
            <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--ink-soft)]">
              For private repos, prefix with a token:{" "}
              <code className="kbd">http://USER:TOKEN@…</code>.
            </p>
          </SidebarSection>

          <SidebarSection title="Owner">
            <SidebarFact label="WebID">
              <SidebarUrl
                href={repo.ownerWebId}
                display={compact(repo.ownerWebId)}
              />
            </SidebarFact>
            <SidebarFact label="Pod root">
              <SidebarUrl
                href={repo.ownerPodRoot}
                display={compact(repo.ownerPodRoot)}
              />
            </SidebarFact>
            <SidebarFact label="Metadata">
              <SidebarUrl
                href={`${trailingSlash(repo.ownerPodRoot)}codespaces/${repo.name}/index.ttl`}
                display={`codespaces/${repo.name}/index.ttl`}
              />
            </SidebarFact>
          </SidebarSection>

          <SidebarSection
            title="Mind Pages"
            trailing={
              pages?.enabled && pages.targetContainer ? (
                <span
                  className="stamp"
                  data-tone="ok"
                  style={{ padding: "0.18rem 0.4rem 0.14rem" }}
                >
                  live
                </span>
              ) : (
                <span
                  className="text-[9px] uppercase tracking-[0.2em] text-[color:var(--ink-faint)]"
                  style={{ fontFamily: "var(--font-mono-src)" }}
                >
                  off
                </span>
              )
            }
          >
            {pages?.enabled && pages.targetContainer ? (
              <>
                <SidebarFact label="Source">
                  <code className="kbd">{pages.sourceBranch}</code>
                  <span className="mx-1 text-[color:var(--ink-faint)]">·</span>
                  <code className="kbd">{pages.sourcePath}</code>
                </SidebarFact>
                <SidebarFact label="Target">
                  <SidebarUrl
                    href={pages.targetContainer}
                    display={pathOf(pages.targetContainer)}
                  />
                </SidebarFact>
                <SidebarFact label="Published">
                  <span className="text-[12px]">
                    {pages.lastPublishedAt ? (
                      <RelativeTime ts={pages.lastPublishedAt} />
                    ) : (
                      "never"
                    )}
                  </span>
                </SidebarFact>
              </>
            ) : (
              <p className="text-[11px] text-[color:var(--ink-soft)]">
                Not enabled. Configure with{" "}
                <code className="kbd">PUT /api/repos/{repo.owner}/{repo.name}/pages</code>.
              </p>
            )}
          </SidebarSection>

          <SidebarSection
            title="Push tokens"
            trailing={
              <span
                className="rounded-sm bg-[color:var(--paper-soft)] px-1.5 py-0.5 text-[10px] tracking-[0.14em] text-[color:var(--ink-soft)]"
                style={{ fontFamily: "var(--font-mono-src)" }}
              >
                {tokens.length}
              </span>
            }
          >
            <details className="group text-sm">
              <summary
                className="flex cursor-pointer items-center justify-between gap-2 rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                style={{ fontFamily: "var(--font-mono-src)" }}
              >
                <span>
                  {tokens.length === 0
                    ? "Mint first token"
                    : `Manage ${tokens.length} ${tokens.length === 1 ? "token" : "tokens"}`}
                </span>
                <span
                  aria-hidden="true"
                  className="text-[color:var(--ink-faint)] transition-transform group-open:rotate-90"
                >
                  ›
                </span>
              </summary>
              <div className="mt-3">
                <TokenManager
                  owner={repo.owner}
                  repo={repo.name}
                  initial={tokens}
                />
              </div>
            </details>
          </SidebarSection>
        </aside>
      </div>
    </div>
  );
}

function PublishStatusBanner({
  pages,
}: {
  pages: ReturnType<typeof getPagesConfig> | null;
}) {
  if (!pages || !pages.enabled) return null;
  if (pages.lastPublishStatus !== "failed" && pages.lastPublishStatus !== "needs-reauth") {
    return null;
  }
  const isAuth = pages.lastPublishStatus === "needs-reauth";
  const label = isAuth ? "Owner needs to re-authorize" : "Last publish failed";
  const action = isAuth ? (
    <a className="link ml-2" href="/connect">
      reauthorize via /connect →
    </a>
  ) : null;
  return (
    <div
      className="mt-6 rounded-l border-l-2 px-4 py-3 text-sm"
      style={{
        borderColor: "var(--status-bad)",
        background: "color-mix(in srgb, var(--status-bad) 6%, transparent)",
      }}
    >
      <p style={{ color: "var(--status-bad)" }}>
        <strong>{label}</strong>
        {action}
      </p>
      {pages.lastPublishError ? (
        <p className="mt-1 break-all text-[color:var(--ink-soft)]" style={{ fontFamily: "var(--font-mono-src)" }}>
          {pages.lastPublishError}
        </p>
      ) : null}
      {pages.lastPublishAttempt ? (
        <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]" style={{ fontFamily: "var(--font-mono-src)" }}>
          attempt · <RelativeTime ts={pages.lastPublishAttempt} />
        </p>
      ) : null}
    </div>
  );
}

function getRunCount(repoId: number): number {
  // Avoid pulling 50 rows just to count. listRunsForRepo doesn't have a
  // count variant; for the prototype we accept that "runCount" is the
  // length of the first page (up to 50 returned by listRunsForRepo with
  // its default limit). 50 is enough to label the strip honestly for
  // any demo data; very long histories will read "50+" instead.
  const rows = listRunsForRepo(repoId, 50);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Page-level header (title, meta strip, action row, status strip)
// ---------------------------------------------------------------------------

function Header({
  repo,
  latestRun,
  publishedUrl,
  pages,
  runCount,
  openIssueCount,
  openPullCount,
  owner,
  name,
  isOwner,
}: {
  repo: ReturnType<typeof getRepo> & object;
  latestRun: WorkflowRun | null;
  publishedUrl: string | null;
  pages: ReturnType<typeof getPagesConfig> | null;
  runCount: number;
  openIssueCount: number;
  openPullCount: number;
  owner: string;
  name: string;
  isOwner: boolean;
}) {
  const buildBadge = latestRun ? renderBuildStatus(latestRun, owner, name) : null;
  const pagesBadge = renderPagesStatus(pages, publishedUrl);
  const runsBadge = renderRunsCount(runCount, owner, name);
  const metaBadges = [buildBadge, pagesBadge, runsBadge].filter(Boolean);

  return (
    <>
      <p className="section-mark">
        <Link href="/repos" className="link">
          ← all repos
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <h1
          className="display break-words text-3xl sm:text-4xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {repo.owner}
          <span className="text-[color:var(--ink-faint)]">/</span>
          <em>{repo.name}</em>
        </h1>
        {latestRun ? (
          <div className="pt-2">
            <RerunButton owner={repo.owner} repo={repo.name} />
          </div>
        ) : null}
      </div>
      <p
        className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {isOrg(repo.owner) ? "org · " : ""}
        {repo.visibility} · default {repo.defaultBranch} · created{" "}
        <RelativeTime ts={repo.createdAt} />
      </p>

      {metaBadges.length > 0 ? (
        <div
          className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.18em]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          {metaBadges.map((item, i) => (
            <span key={i} className="flex items-center gap-2">
              {item}
            </span>
          ))}
        </div>
      ) : null}

      <NavTabs
        tabs={[
          {
            key: "code",
            href: `/repos/${repo.owner}/${repo.name}/tree`,
            label: "Code",
            active: true,
          },
          {
            key: "issues",
            href: `/repos/${repo.owner}/${repo.name}/issues`,
            label: "Issues",
            count: openIssueCount,
          },
          {
            key: "pulls",
            href: `/repos/${repo.owner}/${repo.name}/pulls`,
            label: "Pulls",
            count: openPullCount,
          },
          ...(isOwner
            ? [
                {
                  key: "settings",
                  href: `/repos/${repo.owner}/${repo.name}/settings`,
                  label: "Settings",
                },
              ]
            : []),
          ...(publishedUrl
            ? [
                {
                  key: "live",
                  href: publishedUrl,
                  label: "Live site",
                  external: true,
                },
              ]
            : []),
        ]}
      />
    </>
  );
}

function renderBuildStatus(run: WorkflowRun, owner: string, name: string) {
  const tone =
    run.status === "success"
      ? "ok"
      : run.status === "running" || run.status === "queued"
        ? undefined
        : "bad";
  const symbol = run.status === "success" ? "✓" : run.status === "failed" || run.status === "error" ? "✗" : "·";
  const trailing =
    run.status === "success"
      ? formatDuration(run.startedAt, run.finishedAt)
      : run.status === "failed"
        ? `exit ${run.exitCode ?? "—"}`
        : run.status;
  return (
    <>
      <span className="stamp" data-tone={tone}>
        {symbol} {run.status === "success" ? "build" : run.status}
      </span>
      <Link
        href={`/repos/${owner}/${name}/runs/${run.id}`}
        className="text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
      >
        {trailing}
      </Link>
    </>
  );
}

function renderPagesStatus(
  pages: ReturnType<typeof getPagesConfig> | null,
  publishedUrl: string | null,
) {
  if (!pages?.enabled || !pages.targetContainer) {
    return (
      <span className="text-[color:var(--ink-faint)]">pages off</span>
    );
  }
  return (
    <>
      <span className="stamp" data-tone="ok">
        pages live
      </span>
      {publishedUrl ? (
        <a
          href={publishedUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
        >
          {pages.lastPublishedAt ? (
            <RelativeTime ts={pages.lastPublishedAt} />
          ) : (
            "open ↗"
          )}
        </a>
      ) : null}
    </>
  );
}

function renderRunsCount(
  count: number,
  owner: string,
  name: string,
) {
  if (count === 0) return null;
  const display = count >= 50 ? "50+" : count.toString();
  return (
    <Link
      href={`/repos/${owner}/${name}/runs`}
      className="text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
    >
      {display} {count === 1 ? "run" : "runs"}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main column blocks
// ---------------------------------------------------------------------------

function ReadmeSection({
  owner,
  name,
  readmeName,
  readmeHtml,
}: {
  owner: string;
  name: string;
  readmeName: string;
  readmeHtml: string;
}) {
  return (
    <section>
      <div className="overflow-hidden rounded border border-[color:var(--ink-trace)]">
        <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-4 py-2">
          <span
            className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            <span className="text-[color:var(--ink-faint)]">≡</span> {readmeName}
          </span>
          <Link
            href={`/repos/${owner}/${name}/blob/${readmeName}`}
            className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            view source →
          </Link>
        </div>
        <article
          className="markdown-body bg-[color:var(--paper)] px-4 py-5 sm:px-8 sm:py-7"
          dangerouslySetInnerHTML={{ __html: readmeHtml }}
        />
      </div>
    </section>
  );
}

function EmptyReadme({
  owner,
  name,
  hasCommits,
}: {
  owner: string;
  name: string;
  hasCommits: boolean;
}) {
  return (
    <section className="card text-sm text-[color:var(--ink-soft)]">
      <p
        className="display text-xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {hasCommits ? "No README yet." : "Nothing pushed yet."}
      </p>
      <p className="mt-2">
        {hasCommits ? (
          <>
            Add a <code className="kbd">README.md</code> to the default branch
            and it&apos;ll render here.{" "}
            <Link
              href={`/repos/${owner}/${name}/tree`}
              className="link"
            >
              Browse code →
            </Link>
          </>
        ) : (
          <>
            Clone the repo (see the sidebar) and push your first commit. The
            README and recent builds will appear here.
          </>
        )}
      </p>
    </section>
  );
}

function LatestBuildSection({
  latestRun,
  previousRuns,
  owner,
  repoName,
  totalRuns,
}: {
  latestRun: WorkflowRun;
  previousRuns: WorkflowRun[];
  owner: string;
  repoName: string;
  totalRuns: number;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2
          className="display text-xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Latest build
        </h2>
        <Link
          href={`/repos/${owner}/${repoName}/runs`}
          className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          all {totalRuns >= 50 ? "50+" : totalRuns} runs →
        </Link>
      </div>
      <div className="mt-3">
        <LatestBuild
          run={latestRun}
          owner={owner}
          repoName={repoName}
        />
      </div>
      {previousRuns.length > 0 ? (
        <>
          <h3
            className="mt-6 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Previous runs
          </h3>
          <ul className="mt-2 flex flex-col">
            {previousRuns.map((run) => (
              <li key={run.id}>
                <PreviousRunRow run={run} owner={owner} repoName={repoName} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function PreviousRunRow({
  run,
  owner,
  repoName,
}: {
  run: WorkflowRun;
  owner: string;
  repoName: string;
}) {
  const tone =
    run.status === "success"
      ? "ok"
      : run.status === "running" || run.status === "queued"
        ? undefined
        : "bad";
  const isBad = run.status === "failed" || run.status === "error";
  return (
    <Link
      href={`/repos/${owner}/${repoName}/runs/${run.id}`}
      className="flex items-baseline justify-between gap-3 border-b border-[color:var(--ink-trace)] py-2 text-[11px] uppercase tracking-[0.18em] hover:text-[color:var(--accent)] last:border-b-0"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      <span className="flex items-center gap-3">
        <span className="text-[color:var(--ink-faint)]">#{run.id}</span>
        <span className="stamp" data-tone={tone}>
          {run.status}
        </span>
        {isBad && run.exitCode !== null ? (
          <span className="text-[color:var(--ink-faint)]">
            exit {run.exitCode}
          </span>
        ) : null}
      </span>
      <span className="text-[color:var(--ink-faint)]">
        <RelativeTime ts={run.startedAt} /> ·{" "}
        {formatDuration(run.startedAt, run.finishedAt)}
      </span>
    </Link>
  );
}

function NoBuildsHint() {
  return (
    <section>
      <hr className="hairline" />
      <p className="section-mark mt-6">// workflows</p>
      <p
        className="display mt-2 text-xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Run code before you publish.
      </p>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[color:var(--ink-soft)]">
        Add a <code className="kbd">.mind/workflow.yml</code> to the default
        branch. On push, the bridge checks out your repo into a sandboxed{" "}
        <code className="kbd">node:22-alpine</code> container, runs your{" "}
        <code className="kbd">run:</code> steps, then publishes the result. See{" "}
        <Link href="/repos/alice/built-site" className="link">
          built-site demo
        </Link>{" "}
        for a minimal example.
      </p>
    </section>
  );
}

function LatestBuild({
  run,
  owner,
  repoName,
}: {
  run: WorkflowRun;
  owner: string;
  repoName: string;
}) {
  const tone =
    run.status === "success"
      ? "ok"
      : run.status === "running" || run.status === "queued"
        ? undefined
        : "bad";
  const duration = formatDuration(run.startedAt, run.finishedAt);
  return (
    <div className="text-sm space-y-3">
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2">
        <dt className="text-[color:var(--ink-faint)]">Status</dt>
        <dd>
          <Link
            href={`/repos/${owner}/${repoName}/runs/${run.id}`}
            className="inline-flex items-center gap-3 hover:text-[color:var(--accent)]"
          >
            <span className="stamp" data-tone={tone}>
              {run.status}
            </span>
            <span
              className="text-[color:var(--ink-faint)] text-[11px] uppercase tracking-[0.16em]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              #{run.id}
              {run.exitCode !== null ? ` · exit ${run.exitCode}` : ""}
            </span>
          </Link>
        </dd>
        <dt className="text-[color:var(--ink-faint)]">Started</dt>
        <dd>
          <RelativeTime ts={run.startedAt} />
        </dd>
        <dt className="text-[color:var(--ink-faint)]">Duration</dt>
        <dd>{duration}</dd>
        <dt className="text-[color:var(--ink-faint)]">Ref</dt>
        <dd>
          <code className="kbd">{run.ref}</code>
        </dd>
        {run.errorMessage ? (
          <>
            <dt className="text-[color:var(--ink-faint)]">Error</dt>
            <dd className="text-[color:var(--status-bad)]">
              {run.errorMessage}
            </dd>
          </>
        ) : null}
      </dl>
      {run.logTail ? (
        <details className="rounded border border-[color:var(--ink-trace)] overflow-hidden">
          <summary
            className="cursor-pointer px-3 py-2 bg-[color:var(--paper-soft)] border-b border-[color:var(--ink-trace)] text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Log tail
          </summary>
          <pre
            className="m-0 p-3 overflow-x-auto text-[0.78rem] leading-[1.55] whitespace-pre bg-[color:var(--paper-sunk)] text-[color:var(--ink)] max-w-full"
            style={{ fontFamily: "var(--font-mono-src)", WebkitOverflowScrolling: "touch" }}
          >
            {run.logTail}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar primitives
// ---------------------------------------------------------------------------

function SidebarSection({
  title,
  trailing,
  children,
}: {
  title: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--ink-trace)] pb-1.5">
        <h2
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          {title}
        </h2>
        {trailing ? <div>{trailing}</div> : null}
      </div>
      <div className="mt-3 text-sm">{children}</div>
    </section>
  );
}

function SidebarFact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 last:mb-0">
      <p
        className="text-[9px] uppercase tracking-[0.2em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {label}
      </p>
      <div className="mt-0.5 min-w-0">{children}</div>
    </div>
  );
}

function SidebarUrl({
  href,
  display,
}: {
  href: string;
  display?: string;
}) {
  const text = display ?? href;
  return (
    <a
      href={href}
      title={href}
      target="_blank"
      rel="noreferrer"
      className="link block overflow-hidden text-ellipsis whitespace-nowrap text-[12px]"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      {text}
    </a>
  );
}

function CloneUrlBlock({ url }: { url: string }) {
  return (
    <div className="overflow-hidden rounded border border-[color:var(--ink-trace)]">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-3 py-1.5">
        <span
          className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          git remote
        </span>
        <CopyButton value={url} />
      </div>
      <pre
        className="m-0 px-3 py-2 overflow-x-auto text-[0.78rem] leading-[1.5] whitespace-pre bg-[color:var(--paper)] max-w-full"
        style={{ fontFamily: "var(--font-mono-src)", WebkitOverflowScrolling: "touch" }}
      >
        {url}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

function trailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/** Shrink an absolute URL to its pathname for sidebar density. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** Collapse `http://host/path` → `host/path` for crowded sidebar links. */
function compact(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.hash}`;
  } catch {
    return url;
  }
}
