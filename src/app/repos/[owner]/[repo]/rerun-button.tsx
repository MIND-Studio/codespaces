"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch } from "@/lib/auth/csrf-client";
import { MatrixRain } from "@/components/matrix-rain";

/**
 * Manual workflow re-run trigger. Fires-and-forgets via the runs API,
 * then refreshes the page so the new run appears in the Latest build
 * panel. Disabled while a request is in flight.
 */
export function RerunButton({ owner, repo }: { owner: string; repo: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function trigger() {
    if (!confirm(`Re-run the workflow for ${owner}/${repo}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/repos/${owner}/${repo}/runs`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      // Server-side data is refetched on navigation; router.refresh()
      // re-renders the current route's RSCs without losing local state.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex items-center gap-3">
      <button
        type="button"
        onClick={trigger}
        disabled={busy}
        className="rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-1 text-sm text-[color:var(--paper)] hover:bg-[color:var(--accent-deep)] disabled:opacity-50"
      >
        {busy ? "Triggering…" : "Re-run"}
      </button>
      {busy ? (
        <MatrixRain width={88} height={22} cellSize={8} trailLength={6} />
      ) : null}
      {error ? (
        <span className="text-sm text-[color:var(--status-bad)]">{error}</span>
      ) : null}
    </div>
  );
}
