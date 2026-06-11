import Link from "next/link";
import {
  listRepos,
  getPagesConfig,
} from "@/lib/registry/repos";
import { getLatestRunForRepo } from "@/lib/registry/runs";
import { isOrg } from "@/lib/registry/owners";
import { readSession } from "@/lib/auth/session";
import { RepoList, type RepoRowData } from "./_components/repo-list";

export const dynamic = "force-dynamic";

export default async function ReposPage() {
  const session = await readSession();
  const repos = listRepos();
  const rows: RepoRowData[] = repos.map((repo) => {
    const pages = getPagesConfig(repo.id);
    const latestRun = getLatestRunForRepo(repo.id);
    const pagesEnabled = !!(pages?.enabled && pages.targetContainer);
    // "live" requires an actual publish — an enabled-but-never-published
    // target is a 404 on the pod, not a live site.
    const pagesLive = pagesEnabled && pages!.lastPublishedAt != null;
    const liveUrl = pagesLive
      ? `${pages!.targetContainer}${pages!.targetContainer.endsWith("/") ? "" : "/"}index.html`
      : null;
    const activityAt = Math.max(
      repo.createdAt,
      pages?.lastPublishedAt ?? 0,
      latestRun?.finishedAt ?? 0,
      latestRun?.startedAt ?? 0,
    );
    return {
      id: repo.id,
      owner: repo.owner,
      ownerIsOrg: isOrg(repo.owner),
      name: repo.name,
      visibility: repo.visibility,
      defaultBranch: repo.defaultBranch,
      createdAt: repo.createdAt,
      pagesEnabled,
      pagesLive,
      liveUrl,
      livePath: liveUrl ? pathOnly(liveUrl) : null,
      lastPublishedAt: pages?.lastPublishedAt ?? null,
      latestRun: latestRun
        ? {
            status: latestRun.status,
            startedAt: latestRun.startedAt,
            finishedAt: latestRun.finishedAt,
            exitCode: latestRun.exitCode,
          }
        : null,
      activityAt,
    };
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-10 sm:py-12">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="section-mark">Dashboard</p>
          <h1
            className="display mt-3 text-3xl sm:text-4xl md:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Your <em>repos</em>.
          </h1>
        </div>
        {session ? (
          <Link
            href="/repos/new"
            className="mt-1 rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--paper)] transition-opacity hover:opacity-90"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            + New repo
          </Link>
        ) : (
          <Link
            href="/login"
            className="mt-1 rounded border border-[color:var(--accent)] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)] transition-colors hover:bg-[color:var(--accent)] hover:text-[color:var(--paper)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Sign in to create
          </Link>
        )}
      </div>
      <p className="mt-4 max-w-2xl text-[color:var(--ink-soft)]">
        Everything registered with this bridge. Each row is a real bare Git
        repository on disk plus, optionally, a Mind Pages target on the
        owner&apos;s Solid Pod.
      </p>

      <hr className="hairline my-8" />

      <RepoList rows={rows} signedIn={!!session} />
    </div>
  );
}

/**
 * Shrink an absolute pod URL down to the recognizable tail so the
 * dashboard chip doesn't blow out the card width. We keep everything
 * from `/public/sites/` onward — that's the namespace the user
 * configured. If the URL doesn't match the expected shape, fall back to
 * the pathname so we never render a broken-looking value.
 */
function pathOnly(url: string): string {
  try {
    const u = new URL(url);
    const i = u.pathname.indexOf("/public/sites/");
    if (i >= 0) return u.pathname.slice(i);
    return u.pathname;
  } catch {
    return url;
  }
}
