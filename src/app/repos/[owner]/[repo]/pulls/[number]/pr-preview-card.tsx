"use client";

import { useEffect, useRef, useState } from "react";
import type { PreviewStatus } from "@/lib/registry/pulls";
import { authedFetch } from "@/lib/auth/csrf-client";
import { Button } from "@mind-studio/ui";

const POLL_INTERVAL_MS = 1500;
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g; // eslint-disable-line no-control-regex

type PreviewState = {
  status: PreviewStatus | null;
  url: string | null;
  error: string | null;
  log: string;
};

/**
 * Live PR-preview panel. Shows the published preview link when ready,
 * the build log + a spinner while building, the error when failed, and a
 * Build/Rebuild button. Polls /pulls/{n}/preview while a build is in flight.
 */
export function PrPreviewCard({
  owner,
  repo,
  number,
  initialStatus,
  initialUrl,
  initialError,
}: {
  owner: string;
  repo: string;
  number: number;
  initialStatus: PreviewStatus | null;
  initialUrl: string | null;
  initialError: string | null;
}) {
  const [state, setState] = useState<PreviewState>({
    status: initialStatus,
    url: initialUrl,
    error: initialError,
    log: "",
  });
  const logRef = useRef<HTMLPreElement | null>(null);
  // Gate the poll until a just-fired POST has landed server-side; before
  // that, a GET would read the PREVIOUS preview row (ready/failed/null) and
  // clobber the optimistic "building" state, killing the poll loop.
  const postLanded = useRef(true);
  const base = `/api/repos/${owner}/${repo}/pulls/${number}/preview`;

  // Poll while building.
  useEffect(() => {
    if (state.status !== "building") return;
    let cancelled = false;
    async function tick() {
      try {
        if (!postLanded.current) return;
        const res = await fetch(base, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as PreviewState;
        if (cancelled) return;
        // A null status means "no build recorded yet" — keep polling
        // instead of clobbering back to "not built".
        if (body.status === null) return;
        setState((prev) => ({
          status: body.status,
          url: body.url,
          error: body.error,
          log: body.log || prev.log,
        }));
      } catch {
        /* transient — next tick retries */
      }
    }
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [state.status, base]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [state.log]);

  async function build() {
    postLanded.current = false;
    setState((prev) => ({ ...prev, status: "building", error: null }));
    try {
      const res = await authedFetch(base, { method: "POST" });
      postLanded.current = true;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState((prev) => ({
          ...prev,
          status: "failed",
          error: body.error ?? `preview request failed (HTTP ${res.status})`,
        }));
      }
    } catch (e) {
      setState((prev) => ({
        ...prev,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }

  const tone =
    state.status === "ready"
      ? "ok"
      : state.status === "failed"
        ? "bad"
        : undefined;
  const buildLabel =
    state.status === "building"
      ? "Building…"
      : state.status
        ? "Rebuild preview"
        : "Build preview";

  return (
    <div className="overflow-hidden rounded border border-[color:var(--ink-trace)]">
      <div
        className="flex items-center justify-between gap-3 border-b border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        <span>preview</span>
        {state.status ? (
          <span className="stamp" data-tone={tone}>
            {state.status}
          </span>
        ) : (
          <span className="text-[color:var(--ink-faint)]">not built</span>
        )}
      </div>

      <div className="flex flex-col gap-3 bg-[color:var(--paper)] px-5 py-4">
        {state.status === "ready" && state.url ? (
          <a
            href={state.url}
            target="_blank"
            rel="noreferrer"
            className="link text-sm"
          >
            Open preview ↗
          </a>
        ) : null}

        {state.status === "failed" && state.error ? (
          <p className="text-sm text-[color:var(--status-bad)]">{state.error}</p>
        ) : null}

        {state.status === "building" || state.log ? (
          <pre
            ref={logRef}
            className="max-h-64 overflow-auto rounded bg-[color:var(--paper-soft)] p-3 text-[11px] leading-relaxed text-[color:var(--ink-soft)]"
            style={{ fontFamily: "var(--font-mono-src)", whiteSpace: "pre-wrap" }}
          >
            {state.log.replace(ANSI_ESCAPE, "") ||
              (state.status === "building" ? "Starting build…" : "")}
          </pre>
        ) : null}

        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={build}
            disabled={state.status === "building"}
          >
            {buildLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
