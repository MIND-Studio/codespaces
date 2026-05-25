import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { repoPath } from "@/lib/git/backend";
import {
  hasAnyCommits,
  listBranches,
  listTree,
  type TreeEntry,
} from "@/lib/git/objects";
import { BranchPicker } from "@/components/branch-picker";
import { RepoTabs } from "../../repo-tabs";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string; path?: string[] }>;
  searchParams: Promise<{ ref?: string }>;
};

export default async function TreePage({ params, searchParams }: PageProps) {
  const { owner, repo: name, path } = await params;
  const sp = await searchParams;
  const repo = getRepo(owner, name);
  if (!repo) notFound();

  const bare = repoPath(repo.owner, repo.name);
  const branches = await listBranches(bare).then((bs) =>
    bs.map((b) => b.name).sort((a, b) => a.localeCompare(b)),
  );
  const ref = pickRef(sp.ref, branches, repo.defaultBranch);
  const refQuery = ref === repo.defaultBranch ? null : ref;
  const subpath = (path ?? []).join("/");

  if (!(await hasAnyCommits(bare))) {
    return (
      <PageShell
        owner={repo.owner}
        name={repo.name}
        branch={ref}
        branches={branches}
        defaultBranch={repo.defaultBranch}
        segments={[]}
        refQuery={refQuery}
      >
        <div className="card">
          <p>
            This repo has no commits yet. Push something to{" "}
            <code className="kbd">{ref}</code> and refresh.
          </p>
        </div>
      </PageShell>
    );
  }

  const entries = await listTree(bare, ref, subpath);

  return (
    <PageShell
      owner={repo.owner}
      name={repo.name}
      branch={ref}
      branches={branches}
      defaultBranch={repo.defaultBranch}
      segments={path ?? []}
      refQuery={refQuery}
    >
      {entries.length === 0 ? (
        <div className="card">
          <p>Nothing at this path.</p>
        </div>
      ) : (
        <TreeListing
          owner={repo.owner}
          repoName={repo.name}
          segments={path ?? []}
          entries={entries}
          refQuery={refQuery}
        />
      )}
    </PageShell>
  );
}

function TreeListing({
  owner,
  repoName,
  segments,
  entries,
  refQuery,
}: {
  owner: string;
  repoName: string;
  segments: string[];
  entries: TreeEntry[];
  refQuery: string | null;
}) {
  const isAtRoot = segments.length === 0;
  return (
    <ul className="divide-y divide-[color:var(--ink-trace)] border border-[color:var(--ink-trace)] rounded">
      {!isAtRoot ? (
        <li>
          <Link
            href={hrefForTree(owner, repoName, segments.slice(0, -1), refQuery)}
            className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 px-4 py-2 hover:bg-[color:var(--paper-soft)]"
          >
            <span className="text-[color:var(--ink-faint)]">↖</span>
            <span
              className="text-[color:var(--ink-soft)]"
              style={{ fontFamily: "var(--font-mono-src)", fontSize: "0.875rem" }}
            >
              ..
            </span>
            <span />
          </Link>
        </li>
      ) : null}
      {entries.map((entry) => (
        <li key={entry.sha + entry.name}>
          <Link
            href={
              entry.type === "tree"
                ? hrefForTree(owner, repoName, [...segments, entry.name], refQuery)
                : hrefForBlob(owner, repoName, [...segments, entry.name], refQuery)
            }
            className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-3 px-4 py-2 hover:bg-[color:var(--paper-soft)]"
          >
            <span className="text-[color:var(--ink-faint)]">
              {entry.type === "tree" ? "▸" : entry.type === "commit" ? "⌷" : "·"}
            </span>
            <span style={{ fontFamily: "var(--font-mono-src)", fontSize: "0.875rem" }}>
              {entry.name}
              {entry.type === "tree" ? "/" : ""}
            </span>
            <span
              className="text-[color:var(--ink-faint)] text-[11px]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              {entry.type === "blob" && entry.size !== null
                ? formatBytes(entry.size)
                : ""}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function PageShell({
  owner,
  name,
  branch,
  branches,
  defaultBranch,
  segments,
  refQuery,
  children,
}: {
  owner: string;
  name: string;
  branch: string;
  branches: string[];
  defaultBranch: string;
  segments: string[];
  refQuery: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}`} className="link">
          ← {owner}/{name}
        </Link>
      </p>

      <h1
        className="display mt-3 text-2xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Source
      </h1>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        {branches.length > 1 ? (
          <BranchPicker
            branches={branches}
            current={branch}
            defaultBranch={defaultBranch}
          />
        ) : (
          <p
            className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            branch {branch}
          </p>
        )}
      </div>

      <RepoTabs owner={owner} name={name} active="code" />

      <div className="mt-6">
        <Breadcrumbs
          owner={owner}
          repoName={name}
          segments={segments}
          kind="tree"
          refQuery={refQuery}
        />
      </div>

      <div className="mt-4">{children}</div>
    </div>
  );
}

export function Breadcrumbs({
  owner,
  repoName,
  segments,
  kind,
  refQuery,
}: {
  owner: string;
  repoName: string;
  segments: string[];
  kind: "tree" | "blob";
  refQuery: string | null;
}) {
  // For a blob URL like /blob/a/b/c.html, the last segment is the file
  // — render it as plain text, the intermediate segments as tree links.
  const filename = kind === "blob" ? segments[segments.length - 1] : null;
  const dirSegs = kind === "blob" ? segments.slice(0, -1) : segments;
  return (
    <p
      className="text-sm flex flex-wrap items-center gap-1"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      <Link href={hrefForTree(owner, repoName, [], refQuery)} className="link">
        {repoName}
      </Link>
      {dirSegs.map((seg, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span className="text-[color:var(--ink-faint)]">/</span>
          <Link
            href={hrefForTree(owner, repoName, dirSegs.slice(0, i + 1), refQuery)}
            className="link"
          >
            {seg}
          </Link>
        </span>
      ))}
      {filename ? (
        <span className="inline-flex items-center gap-1">
          <span className="text-[color:var(--ink-faint)]">/</span>
          <span className="text-[color:var(--ink)]">{filename}</span>
        </span>
      ) : null}
    </p>
  );
}

/**
 * Pick a valid ref to render. We never feed arbitrary user input to git
 * commands; the requested ref must appear in `branches` to be honoured.
 * Falls back to the default branch on anything unrecognised so a stale
 * URL doesn't 404 the whole page.
 */
function pickRef(
  requested: string | undefined,
  branches: string[],
  defaultBranch: string,
): string {
  if (requested && branches.includes(requested)) return requested;
  return defaultBranch;
}

function hrefForTree(
  owner: string,
  repoName: string,
  segs: string[],
  refQuery: string | null,
): string {
  const path = segs.map(encodeURIComponent).join("/");
  const base = path
    ? `/repos/${owner}/${repoName}/tree/${path}`
    : `/repos/${owner}/${repoName}/tree`;
  return refQuery ? `${base}?ref=${encodeURIComponent(refQuery)}` : base;
}

function hrefForBlob(
  owner: string,
  repoName: string,
  segs: string[],
  refQuery: string | null,
): string {
  const path = segs.map(encodeURIComponent).join("/");
  const base = `/repos/${owner}/${repoName}/blob/${path}`;
  return refQuery ? `${base}?ref=${encodeURIComponent(refQuery)}` : base;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
