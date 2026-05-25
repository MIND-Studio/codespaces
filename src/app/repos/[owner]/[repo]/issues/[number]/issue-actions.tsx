"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authedFetch } from "@/lib/auth/csrf-client";

/**
 * Issue-page actions:
 *   • Close / Reopen — toggles the issue status.
 *   • Re-run coder — manually re-fires the coder on this issue (the
 *     coder also auto-fires on issue.created and issue.commented, so
 *     this button only matters when a run errored or you want to
 *     retry without leaving a comment).
 */
export function IssueActions({
  owner,
  repo,
  number,
  status,
  hasOpenRun,
}: {
  owner: string;
  repo: string;
  number: number;
  status: "open" | "closed";
  hasOpenRun: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"toggle" | "run" | null>(null);

  async function toggle() {
    setBusy("toggle");
    try {
      const next = status === "open" ? "closed" : "open";
      const res = await authedFetch(`/api/repos/${owner}/${repo}/issues/${number}`, {
        method: "PATCH",
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `request failed: ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function rerunCoder() {
    setBusy("run");
    try {
      // Fire-and-forget — the dispatch holds the response open for
      // however long opencode takes (minutes). We just want the run
      // row inserted; the UI flips into the live-tail state on refresh.
      void authedFetch(`/api/agents/dispatch`, {
        method: "POST",
        body: JSON.stringify({
          type: "issue.created",
          repoOwner: owner,
          repoName: repo,
          issueNumber: number,
        }),
      }).catch(() => {});
      setTimeout(() => router.refresh(), 600);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={busy !== null}
        className="inline-block rounded border border-[color:var(--ink-trace)] px-3 py-1.5 text-sm hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:opacity-50"
      >
        {busy === "toggle" ? "…" : status === "open" ? "Close issue" : "Reopen issue"}
      </button>
      {status === "open" ? (
        <button
          type="button"
          onClick={rerunCoder}
          disabled={busy !== null || hasOpenRun}
          title={
            hasOpenRun
              ? "A coder run is already in flight"
              : "Re-fire the coder on this issue (auto-fires on create + comment)"
          }
          className="inline-block rounded border border-[color:var(--accent)] bg-[color:var(--paper)] px-3 py-1.5 text-sm text-[color:var(--accent)] hover:bg-[color:var(--accent)] hover:text-[color:var(--paper)] disabled:opacity-50"
        >
          {busy === "run"
            ? "Dispatching…"
            : hasOpenRun
              ? "Coder running…"
              : "Re-run coder"}
        </button>
      ) : null}
    </div>
  );
}
