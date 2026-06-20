"use client";

import { Button } from "@mind-studio/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authedFetch } from "@/lib/auth/csrf-client";

/**
 * Merge/close buttons for an open PR. Both fire server actions through
 * the bridge REST API and refresh the page on success.
 */
export function PullActions({
  owner,
  repo,
  number,
}: {
  owner: string;
  repo: string;
  number: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"merge" | "close" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fire(action: "merge" | "close") {
    setBusy(action);
    setError(null);
    try {
      const res = await authedFetch(`/api/repos/${owner}/${repo}/pulls/${number}/${action}`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `${action} failed (HTTP ${res.status})`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => fire("merge")} disabled={busy !== null}>
          {busy === "merge" ? "Merging…" : "Merge pull request"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fire("close")}
          disabled={busy !== null}
        >
          {busy === "close" ? "Closing…" : "Close without merging"}
        </Button>
      </div>
      {error ? <p className="text-sm text-[color:var(--status-bad)]">{error}</p> : null}
    </div>
  );
}
