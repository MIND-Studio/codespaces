"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authedFetch } from "@/lib/auth/csrf-client";

export function CommentForm({
  owner,
  repo,
  number,
}: {
  owner: string;
  repo: string;
  number: number;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await authedFetch(
        `/api/repos/${owner}/${repo}/issues/${number}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ body }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `request failed: ${res.status}`);
      }
      setBody("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Leave a comment
        </span>
        <textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="mt-1 w-full rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-2 text-sm leading-relaxed focus:border-[color:var(--accent)] focus:outline-none"
          style={{ fontFamily: "var(--font-mono-src)" }}
        />
      </label>
      {error ? (
        <p className="text-sm text-[color:var(--status-bad)]">{error}</p>
      ) : null}
      <button
        type="submit"
        disabled={busy || body.trim().length === 0}
        className="inline-block rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-1.5 text-sm text-[color:var(--paper)] hover:bg-[color:var(--accent-deep)] disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Comment"}
      </button>
    </form>
  );
}
