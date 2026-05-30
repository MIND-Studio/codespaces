"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/auth/csrf-client";
import { SignInWall } from "@/components/sign-in-wall";

/**
 * Issue comment composer. Designed to feel like a chat composer rather
 * than a 2003-style form: textarea auto-grows with content (no inner
 * scrollbar until very long), Cmd/Ctrl+Enter submits, and the helper
 * row underneath flips between an idle hint and a "you have unsaved
 * text" indicator so the user can't accidentally walk away mid-comment.
 */
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
  const [unauthed, setUnauthed] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow: every render, snap the textarea height to its scrollHeight
  // (capped) so it expands with the user's text. Floors at ~5 rows so the
  // empty state still feels like a "compose" affordance, not a tweet input.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const target = Math.min(el.scrollHeight, 480);
    el.style.height = `${Math.max(target, 120)}px`;
  }, [body]);

  async function submit() {
    if (busy || body.trim().length === 0) return;
    setError(null);
    setUnauthed(false);
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
        // 401 = session missing/expired. Promote it from a red string of
        // text to the proper SignInWall card so the user has a one-click
        // path to recover (without losing their draft).
        if (res.status === 401) {
          setUnauthed(true);
          return;
        }
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

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit();
  }

  const hasDraft = body.trim().length > 0;
  // Detect Mac vs other for the keyboard hint (best-effort, hydration-safe
  // because we render the same string on the server initially).
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPod|iPhone|iPad/i.test(navigator.platform);
  const sendShortcut = isMac ? "⌘ Enter" : "Ctrl+Enter";

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div
        className={`overflow-hidden rounded border bg-[color:var(--paper)] transition-colors ${
          hasDraft
            ? "border-[color:var(--accent)]/60"
            : "border-[color:var(--ink-trace)] focus-within:border-[color:var(--accent)]"
        }`}
      >
        <div
          className="flex items-center justify-between gap-3 border-b border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <span>Leave a comment</span>
          <span>
            {hasDraft ? (
              <span className="text-[color:var(--accent)]">draft · {body.length} ch</span>
            ) : (
              "Markdown supported"
            )}
          </span>
        </div>
        <textarea
          ref={taRef}
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Write a reply. Anything you commit to the conversation re-fires the coder."
          aria-label="Comment body"
          className="block w-full resize-none bg-transparent px-3 py-3 text-sm leading-relaxed focus:outline-none"
          style={{ fontFamily: "var(--font-mono-src)", minHeight: 120 }}
          disabled={busy}
        />
      </div>
      {unauthed ? (
        <SignInWall
          action="post this comment"
          next={
            typeof window !== "undefined"
              ? `${window.location.pathname}${window.location.hash}`
              : undefined
          }
          compact
        />
      ) : error ? (
        <p className="text-sm text-[color:var(--status-bad)]">{error}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          press <kbd className="kbd">{sendShortcut}</kbd> to send
        </p>
        <div className="flex items-center gap-2">
          {hasDraft && !busy ? (
            <button
              type="button"
              onClick={() => setBody("")}
              className="rounded border border-[color:var(--ink-trace)] px-3 py-1.5 text-sm text-[color:var(--ink-soft)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
            >
              Clear
            </button>
          ) : null}
          <button
            type="submit"
            disabled={busy || !hasDraft}
            className="inline-block rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-1.5 text-sm text-[color:var(--paper)] hover:bg-[color:var(--accent-deep)] disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Comment"}
          </button>
        </div>
      </div>
    </form>
  );
}
