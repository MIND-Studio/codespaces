"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch } from "@/lib/auth/csrf-client";
import {
  Button,
  buttonVariants,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@mind-studio/ui";

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
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={busy}>
            {busy ? "Triggering…" : "Re-run"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-run workflow?</AlertDialogTitle>
            <AlertDialogDescription>
              Re-run the workflow for {owner}/{repo}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="confirm-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="confirm-accept"
              className={buttonVariants({ variant: "destructive" })}
              onClick={trigger}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error ? (
        <span className="text-sm text-[color:var(--status-bad)]">{error}</span>
      ) : null}
    </div>
  );
}
