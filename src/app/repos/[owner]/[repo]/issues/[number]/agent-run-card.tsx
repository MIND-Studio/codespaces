"use client";

import { useEffect, useRef, useState } from "react";
import { RelativeTime } from "@/components/relative-time";
import type { AgentRun } from "@/lib/registry/agent-runs";

const POLL_INTERVAL_MS = 1000;
const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g; // eslint-disable-line no-control-regex

/**
 * Renders one agent_runs row. While the row is `running`, polls
 * /api/agent-runs/{id}/log every second to tail the live container
 * output and /api/agent-runs/{id} to detect when the run finishes.
 * Once it's in a terminal state, parses the structured summary into
 * a headline + changed-files chips + monospace tail so the long
 * opencode dump isn't squashed into a single wrapping `<p>`.
 */
export function AgentRunCard({ run: initial }: { run: AgentRun }) {
  const [run, setRun] = useState<AgentRun>(initial);
  const [log, setLog] = useState<string>("");
  const [logSize, setLogSize] = useState<number>(0);
  const [logAvailable, setLogAvailable] = useState<boolean>(false);
  const logRef = useRef<HTMLPreElement | null>(null);
  const sinceRef = useRef<number>(0);

  useEffect(() => {
    if (run.status !== "running") return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(
          `/api/agent-runs/${run.id}/log?since=${sinceRef.current}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          content: string;
          size: number;
          status: AgentRun["status"];
          logAvailable: boolean;
        };
        if (cancelled) return;
        if (body.content) {
          setLog((prev) => prev + body.content);
        }
        sinceRef.current = body.size;
        setLogSize(body.size);
        setLogAvailable(body.logAvailable);
        if (body.status !== "running") {
          const r = await fetch(`/api/agent-runs/${run.id}`, {
            cache: "no-store",
          });
          if (r.ok) {
            const json = (await r.json()) as { run: AgentRun };
            setRun(json.run);
          }
        }
      } catch {
        // Transient blips don't deserve UI — the next tick retries.
      }
    }

    const handle = setInterval(tick, POLL_INTERVAL_MS);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [run.id, run.status]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [log]);

  const tone =
    run.status === "ok"
      ? "ok"
      : run.status === "running"
        ? undefined
        : "bad";

  return (
    <div className="overflow-hidden rounded border border-[color:var(--ink-trace)]">
      <CardKeyframes />
      <div className="flex items-center justify-between gap-3 border-b border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-4 py-2">
        <span
          className="flex items-center gap-3 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <span className="stamp" data-tone={tone}>
            {run.role}
          </span>
          <span className="text-[color:var(--ink-faint)]">via {run.driver}</span>
          {run.status === "running" ? <LiveBadge /> : null}
        </span>
        <span
          className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <RelativeTime ts={run.createdAt} />
        </span>
      </div>
      <div className="bg-[color:var(--paper)] px-5 py-4">
        {run.status === "running" ? (
          <LiveLog
            log={log}
            logAvailable={logAvailable}
            logSize={logSize}
            refEl={logRef}
          />
        ) : run.errorMessage ? (
          <p className="text-sm text-[color:var(--status-bad)]">
            <strong>error:</strong> {run.errorMessage}
          </p>
        ) : (
          <CompletedSummary summary={run.summary} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

function LiveBadge() {
  return (
    <span
      className="mc-live-badge inline-flex items-center gap-1.5 rounded-sm border border-[color:var(--accent)] bg-[color:var(--accent)]/10 px-1.5 py-0.5 text-[9px] tracking-[0.22em] text-[color:var(--accent)]"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      <span className="mc-live-dot inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--accent)]" />
      live
    </span>
  );
}

function LiveLog({
  log,
  logAvailable,
  logSize,
  refEl,
}: {
  log: string;
  logAvailable: boolean;
  logSize: number;
  refEl: React.RefObject<HTMLPreElement | null>;
}) {
  const cleaned = stripAnsi(log);
  const lineCount = cleaned.split("\n").length;
  return (
    <div
      className="mc-terminal relative overflow-hidden rounded"
      style={{
        background: "#06080a",
        border: "1px solid color-mix(in srgb, var(--accent) 35%, transparent)",
        boxShadow:
          "0 0 0 1px color-mix(in srgb, var(--accent) 10%, transparent), 0 0 24px color-mix(in srgb, var(--accent) 18%, transparent), inset 0 0 30px rgba(0, 0, 0, 0.7)",
      }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-3 py-1.5 text-[10px] uppercase tracking-[0.22em]"
        style={{
          fontFamily: "var(--font-mono-src)",
          background: "rgba(255, 255, 255, 0.02)",
          borderBottomColor: "color-mix(in srgb, var(--accent) 28%, transparent)",
          color: "rgba(225, 232, 220, 0.7)",
        }}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-3 w-[3px]"
            style={{
              background: "var(--accent)",
              boxShadow: "0 0 8px color-mix(in srgb, var(--accent) 80%, transparent)",
            }}
          />
          <span style={{ color: "var(--accent)", textShadow: "0 0 6px color-mix(in srgb, var(--accent) 55%, transparent)" }}>
            engineer
          </span>
          <span style={{ color: "rgba(255, 255, 255, 0.2)" }}>/</span>
          <span>coder</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="mc-term-live flex items-center gap-1.5">
            <span
              className="mc-term-live-dot inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: "var(--accent)",
                boxShadow: "0 0 8px var(--accent), 0 0 14px color-mix(in srgb, var(--accent) 55%, transparent)",
              }}
            />
            <span style={{ color: "var(--accent)" }}>live</span>
          </span>
          <span style={{ color: "rgba(255, 255, 255, 0.18)" }}>·</span>
          <span title={`${lineCount} lines`}>{lineCount.toLocaleString()} ln</span>
          <span style={{ color: "rgba(255, 255, 255, 0.18)" }}>·</span>
          <span title={`${logSize.toLocaleString()} bytes`}>
            {formatBytes(logSize)}
          </span>
        </span>
      </div>
      <pre
        ref={refEl}
        className="mc-term-body relative m-0 max-h-96 overflow-auto p-4 text-[12px] leading-[1.55]"
        style={{
          fontFamily: "var(--font-mono-src)",
          color: "#d8e6d4",
          textShadow: "0 0 1px color-mix(in srgb, var(--accent) 25%, transparent)",
        }}
      >
        {!logAvailable && !cleaned ? (
          <span style={{ color: "rgba(216, 230, 212, 0.45)", fontStyle: "italic" }}>
            waiting for driver to start producing output
            <Ellipsis />
          </span>
        ) : (
          <>
            {cleaned || "(no output yet)"}
            <Cursor />
          </>
        )}
      </pre>
      <span
        aria-hidden
        className="mc-term-progress absolute bottom-0 left-0 h-[1px]"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--accent), transparent)",
          boxShadow: "0 0 6px var(--accent)",
        }}
      />
      {/* HUD corner brackets — only render in neo via CSS scoping below */}
      <span aria-hidden className="mc-term-corner mc-term-corner-tl" />
      <span aria-hidden className="mc-term-corner mc-term-corner-br" />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kb`;
  return `${(n / 1024 / 1024).toFixed(2)} mb`;
}

function Cursor() {
  return (
    <span
      aria-hidden
      className="mc-cursor ml-0.5 inline-block h-[14px] w-[7px] translate-y-[3px]"
      style={{
        background: "var(--accent)",
        boxShadow:
          "0 0 8px var(--accent), 0 0 14px color-mix(in srgb, var(--accent) 50%, transparent)",
      }}
    />
  );
}

function Ellipsis() {
  return (
    <span aria-hidden className="mc-ellipsis">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Completed state
// ---------------------------------------------------------------------------

type ParsedSummary = {
  headline: string;
  files: string[];
  tail: string;
};

const FILES_LINE = /^Changed files \((\d+)\):\s*$/;
const TAIL_DIVIDER = /^---\s+opencode output[^-]*---\s*$/i;

/**
 * Pull the engineer driver's summary string into structured parts so
 * the UI can render each one with appropriate styling. Format is
 * controlled by the driver itself (`coder.ts`), so the parser is
 * permissive: anything it doesn't recognise lands in `tail`, which
 * means a driver change can't render the card blank.
 */
function parseSummary(input: string): ParsedSummary {
  const lines = input.split("\n");
  let headline = "";
  const files: string[] = [];
  const tail: string[] = [];
  let mode: "headline" | "files" | "tail" = "headline";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (mode === "headline") {
      if (!line.trim()) continue;
      headline = line;
      mode = "files";
      continue;
    }
    if (mode === "files") {
      if (FILES_LINE.test(line)) continue;
      if (/^\s+-\s+/.test(line)) {
        files.push(line.replace(/^\s+-\s+/, ""));
        continue;
      }
      if (TAIL_DIVIDER.test(line)) {
        mode = "tail";
        continue;
      }
      // anything else with content flips us to tail mode and is kept
      if (line.trim()) {
        mode = "tail";
        tail.push(line);
      }
      continue;
    }
    tail.push(line);
  }

  // Trim leading + trailing blanks on the tail
  while (tail.length && !tail[0].trim()) tail.shift();
  while (tail.length && !tail[tail.length - 1].trim()) tail.pop();

  return { headline: headline.trim(), files, tail: tail.join("\n") };
}

function CompletedSummary({ summary }: { summary: string }) {
  const parsed = parseSummary(summary);
  const cleanedTail = stripAnsi(parsed.tail);

  return (
    <div className="space-y-3 text-sm">
      {parsed.headline ? (
        <p className="text-[color:var(--ink)] leading-relaxed">
          {parsed.headline}
        </p>
      ) : null}

      {parsed.files.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            changed
          </span>
          {parsed.files.map((f) => (
            <code
              key={f}
              className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-1.5 py-0.5 text-[12px] text-[color:var(--ink)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              {f}
            </code>
          ))}
        </div>
      ) : null}

      {cleanedTail ? (
        <details className="group rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] open:bg-[color:var(--paper-sunk)]">
          <summary
            className="flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className="inline-block transition-transform group-open:rotate-90">›</span>
              opencode output
            </span>
            <span className="text-[color:var(--ink-faint)]">
              {cleanedTail.length.toLocaleString()} chars
            </span>
          </summary>
          <div
            className="mc-terminal relative border-t border-[color:var(--ink-trace)]"
            style={{
              background: "#06080a",
              boxShadow:
                "0 0 18px color-mix(in srgb, var(--accent) 10%, transparent) inset",
            }}
          >
            <pre
              className="mc-term-body m-0 max-h-80 overflow-auto p-4 text-[12px] leading-[1.55]"
              style={{
                fontFamily: "var(--font-mono-src)",
                color: "#d8e6d4",
                textShadow: "0 0 1px color-mix(in srgb, var(--accent) 25%, transparent)",
              }}
            >
              {cleanedTail}
            </pre>
            <span aria-hidden className="mc-term-corner mc-term-corner-tl" />
            <span aria-hidden className="mc-term-corner mc-term-corner-br" />
          </div>
        </details>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripAnsi(s: string): string {
  return s.replace(ANSI_ESCAPE, "");
}

/**
 * Keyframes for the live indicator + cursor + waiting ellipsis. Kept
 * inline (rather than in globals.css) so this component is fully
 * self-contained and globals stays lean. The animations only run while
 * the card is mounted, which only happens when a run exists, so the
 * cost of always-on style insertion is fine.
 */
function CardKeyframes() {
  return (
    <style>{`
      @keyframes mc-pulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%      { opacity: 0.35; transform: scale(0.75); }
      }
      @keyframes mc-glow {
        0%, 100% { box-shadow: 0 0 0 0 rgba(186, 124, 36, 0.0); }
        50%      { box-shadow: 0 0 0 4px rgba(186, 124, 36, 0.18); }
      }
      @keyframes mc-blink {
        0%, 49%   { opacity: 1; }
        50%, 100% { opacity: 0; }
      }
      @keyframes mc-ellipsis {
        0%, 20%   { opacity: 0; }
        50%       { opacity: 1; }
        80%, 100% { opacity: 0; }
      }
      @keyframes mc-term-scan {
        from { transform: translateY(-100%); }
        to   { transform: translateY(100%); }
      }
      @keyframes mc-term-progress {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
      @keyframes mc-term-live-dot {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%      { opacity: 0.5; transform: scale(0.7); }
      }
      .mc-live-dot {
        animation: mc-pulse 1.4s ease-in-out infinite;
      }
      .mc-live-badge {
        animation: mc-glow 2.2s ease-in-out infinite;
      }
      .mc-cursor {
        animation: mc-blink 1s steps(2, start) infinite;
      }
      .mc-ellipsis span {
        display: inline-block;
        animation: mc-ellipsis 1.4s infinite both;
      }
      .mc-ellipsis span:nth-child(2) { animation-delay: 0.2s; }
      .mc-ellipsis span:nth-child(3) { animation-delay: 0.4s; }

      /* Sci-fi terminal — scan-line overlay + bottom progress sweep */
      .mc-term-body {
        background-image:
          repeating-linear-gradient(
            0deg,
            rgba(255, 255, 255, 0.018) 0px,
            rgba(255, 255, 255, 0.018) 1px,
            transparent 1px,
            transparent 3px
          );
        background-attachment: local;
      }
      .mc-term-live-dot {
        animation: mc-term-live-dot 1.4s ease-in-out infinite;
      }
      .mc-term-progress {
        width: 30%;
        animation: mc-term-progress 2.2s ease-in-out infinite;
      }

      /* HUD corner brackets — visible only in neo theme */
      .mc-term-corner {
        position: absolute;
        width: 10px;
        height: 10px;
        border: 1px solid var(--accent);
        box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 60%, transparent);
        pointer-events: none;
        opacity: 0;
      }
      [data-theme="neo"] .mc-term-corner { opacity: 1; }
      .mc-term-corner-tl { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
      .mc-term-corner-br { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }

      @media (prefers-reduced-motion: reduce) {
        .mc-live-dot, .mc-live-badge, .mc-cursor, .mc-ellipsis span,
        .mc-term-live-dot, .mc-term-progress {
          animation: none;
        }
      }
    `}</style>
  );
}
