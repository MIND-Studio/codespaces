import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { repoPath } from "@/lib/git/backend";
import { listBranches, readBlob } from "@/lib/git/objects";
import { Breadcrumbs } from "@/app/repos/[owner]/[repo]/tree/[[...path]]/page";
import { BranchPicker } from "@/components/branch-picker";
import { RepoTabs } from "../../repo-tabs";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string; path: string[] }>;
  searchParams: Promise<{ ref?: string }>;
};

export default async function BlobPage({ params, searchParams }: PageProps) {
  const { owner, repo: name, path } = await params;
  const sp = await searchParams;
  const repo = getRepo(owner, name);
  if (!repo) notFound();

  const bare = repoPath(repo.owner, repo.name);
  const branches = await listBranches(bare).then((bs) =>
    bs.map((b) => b.name).sort((a, b) => a.localeCompare(b)),
  );
  const ref =
    sp.ref && branches.includes(sp.ref) ? sp.ref : repo.defaultBranch;
  const refQuery = ref === repo.defaultBranch ? null : ref;
  const subpath = path.join("/");

  const blob = await readBlob(bare, ref, subpath);
  if (!blob) notFound();

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
        <p
          className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          {formatBytes(blob.totalSize)}
          {blob.truncated ? " · truncated" : ""}
          {blob.isBinary ? " · binary" : ""}
          {branches.length <= 1 ? ` · ${ref}` : ""}
        </p>
        {branches.length > 1 ? (
          <BranchPicker
            branches={branches}
            current={ref}
            defaultBranch={repo.defaultBranch}
          />
        ) : null}
      </div>

      <RepoTabs owner={owner} name={name} active="code" />

      <div className="mt-6">
        <Breadcrumbs
          owner={owner}
          repoName={name}
          segments={path}
          kind="blob"
          refQuery={refQuery}
        />
      </div>

      <div className="mt-4">
        {blob.isBinary ? (
          <BinaryPlaceholder size={blob.totalSize} />
        ) : (
          <TextBlob content={blob.bytes.toString("utf-8")} truncated={blob.truncated} />
        )}
      </div>
    </div>
  );
}

function TextBlob({ content, truncated }: { content: string; truncated: boolean }) {
  const lines = content.split("\n");
  // Drop the trailing empty line that comes from a final newline so we
  // don't render a phantom empty row.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const width = String(lines.length).length;
  return (
    <div className="border border-[color:var(--ink-trace)] rounded overflow-hidden bg-[color:var(--paper-sunk)] min-w-0 max-w-full">
      <pre
        className="overflow-x-auto text-[0.8125rem] leading-[1.5] p-0 m-0 max-w-full"
        style={{ fontFamily: "var(--font-mono-src)", WebkitOverflowScrolling: "touch" }}
      >
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-[auto_minmax(0,1fr)]">
            <span
              className="px-3 pr-4 select-none text-right text-[color:var(--ink-faint)] border-r border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)]"
              style={{ minWidth: `${width + 2}ch` }}
            >
              {i + 1}
            </span>
            <span className="px-3 whitespace-pre">{line || " "}</span>
          </div>
        ))}
      </pre>
      {truncated ? (
        <div className="px-4 py-2 text-xs text-[color:var(--ink-faint)] border-t border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)]">
          File truncated for display. Clone the repo to see the full content.
        </div>
      ) : null}
    </div>
  );
}

function BinaryPlaceholder({ size }: { size: number }) {
  return (
    <div className="card text-sm text-[color:var(--ink-soft)]">
      Binary file ({formatBytes(size)}). Clone the repo to inspect it.
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
