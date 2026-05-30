import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { getRunById, type WorkflowRun } from "@/lib/registry/runs";
import { RepoTabs } from "../../repo-tabs";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string; id: string }>;
};

export default async function RunDetailPage({ params }: PageProps) {
  const { owner, repo: name, id } = await params;
  const repo = getRepo(owner, name);
  if (!repo) notFound();
  const numericId = Number.parseInt(id, 10);
  if (!Number.isInteger(numericId)) notFound();
  const run = getRunById(numericId);
  if (!run || run.repoId !== repo.id) notFound();

  const tone =
    run.status === "success"
      ? "ok"
      : run.status === "running" || run.status === "queued"
        ? undefined
        : "bad";
  const dur =
    run.finishedAt != null
      ? `${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s`
      : "—";

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}/runs`} className="link">
          ← all runs
        </Link>
      </p>
      <h1
        className="display mt-3 text-3xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Run <em>#{run.id}</em>
      </h1>
      <p
        className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {owner}/{name} · {run.ref}
      </p>

      <RepoTabs owner={owner} name={name} active="runs" />

      <hr className="hairline my-8" />

      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-[color:var(--ink-faint)]">Status</dt>
        <dd>
          <span className="stamp" data-tone={tone}>{run.status}</span>
          {run.exitCode !== null ? (
            <span
              className="ml-3 text-[color:var(--ink-faint)] text-[11px] uppercase tracking-[0.16em]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              exit {run.exitCode}
            </span>
          ) : null}
        </dd>
        <dt className="text-[color:var(--ink-faint)]">Started</dt>
        <dd>{formatDate(run.startedAt)}</dd>
        <dt className="text-[color:var(--ink-faint)]">Finished</dt>
        <dd>{run.finishedAt != null ? formatDate(run.finishedAt) : "—"}</dd>
        <dt className="text-[color:var(--ink-faint)]">Duration</dt>
        <dd>{dur}</dd>
        {run.errorMessage ? (
          <>
            <dt className="text-[color:var(--ink-faint)]">Error</dt>
            <dd className="text-[color:var(--status-bad)]">{run.errorMessage}</dd>
          </>
        ) : null}
      </dl>

      <h2
        className="display mt-8 text-xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Log
      </h2>
      {run.logTail ? (
        <pre
          className="mt-3 rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper-sunk)] px-4 py-3 text-[0.8125rem] leading-[1.55] overflow-x-auto whitespace-pre max-w-full"
          style={{ fontFamily: "var(--font-mono-src)", WebkitOverflowScrolling: "touch" }}
        >
{run.logTail}
        </pre>
      ) : (
        <p className="mt-3 text-sm text-[color:var(--ink-soft)]">
          No log captured.
        </p>
      )}
    </div>
  );
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 19).replace("T", " ") + "Z";
}
