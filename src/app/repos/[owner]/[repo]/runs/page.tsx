import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { listRunsForRepo, type WorkflowRun } from "@/lib/registry/runs";
import { RelativeTime } from "@/components/relative-time";
import { formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function RunsPage({ params }: PageProps) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) notFound();
  const runs = listRunsForRepo(repo.id, 50);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}`} className="link">
          ← {owner}/{name}
        </Link>
      </p>
      <h1
        className="display mt-3 text-3xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        All <em>runs</em>
      </h1>
      <p
        className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        latest 50 · newest first
      </p>

      <hr className="hairline my-8" />

      {runs.length === 0 ? (
        <RunsEmptyState />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {runs.map((r) => (
            <li key={r.id}>
              <RunCard run={r} owner={owner} name={name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RunsEmptyState() {
  return (
    <section>
      <p className="section-mark">// runs</p>
      <h2
        className="display mt-3 text-3xl text-[color:var(--ink)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Workflows haven&apos;t <em>fired</em> yet.
      </h2>
      <p className="mt-4 max-w-xl leading-relaxed text-[color:var(--ink-soft)]">
        A push only records a run when the repo contains a{" "}
        <code className="kbd">.mind/workflow.yml</code> at its root. Without
        one, the bridge accepts the push, publishes Pages if configured, and
        stays quiet here.
      </p>
      <p className="mt-3 max-w-xl leading-relaxed text-[color:var(--ink-soft)]">
        See{" "}
        <Link href="/how-it-works" className="link">
          how it works
        </Link>{" "}
        for the workflow schema, or peek at{" "}
        <Link href="/repos/alice/built-site" className="link">
          alice/built-site
        </Link>{" "}
        for a repo whose pushes do trigger a run.
      </p>
    </section>
  );
}

function RunCard({
  run,
  owner,
  name,
}: {
  run: WorkflowRun;
  owner: string;
  name: string;
}) {
  const failureSummary = summarizeFailure(run);
  const isBad = run.status === "failed" || run.status === "error";
  return (
    <Link
      href={`/repos/${owner}/${name}/runs/${run.id}`}
      className="card block hover:border-[color:var(--accent)]"
      style={
        isBad
          ? {
              borderLeftWidth: "3px",
              borderLeftColor: "var(--status-bad)",
            }
          : undefined
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span
            className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            #{run.id}
          </span>
          <StatusBadge run={run} />
          {run.exitCode !== null && run.status !== "success" ? (
            <span
              className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              exit {run.exitCode}
            </span>
          ) : null}
        </div>
        <span
          className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <RelativeTime ts={run.startedAt} /> ·{" "}
          {formatDuration(run.startedAt, run.finishedAt)}
        </span>
      </div>
      <p
        className="mt-2 text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {run.ref}
      </p>
      {failureSummary ? (
        <p
          className="mt-2 text-[0.78rem] leading-snug text-[color:var(--status-bad)] truncate"
          style={{ fontFamily: "var(--font-mono-src)" }}
          title={failureSummary}
        >
          ↳ {failureSummary}
        </p>
      ) : null}
    </Link>
  );
}

function StatusBadge({ run }: { run: WorkflowRun }) {
  const tone =
    run.status === "success"
      ? "ok"
      : run.status === "running" || run.status === "queued"
        ? undefined
        : "bad";
  return (
    <span className="stamp" data-tone={tone}>
      {run.status}
    </span>
  );
}

/**
 * Best-effort one-line summary for failed/error runs. Prefers the
 * persisted `errorMessage` (set by the runner on schema or publish
 * failures); otherwise falls back to the last non-empty log line, which
 * for `set -e` batches is typically `[batch exited N]` or the command's
 * own last bit of output.
 */
function summarizeFailure(run: WorkflowRun): string | null {
  if (run.status !== "failed" && run.status !== "error") return null;
  if (run.errorMessage) return truncate(run.errorMessage, 140);
  if (!run.logTail) return null;
  const lines = run.logTail
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  return truncate(lines[lines.length - 1], 140);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
