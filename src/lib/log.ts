/**
 * Minimal structured logger (§3.1).
 *
 * Goals: NDJSON output in production for shipping to a log pipeline,
 * human-readable lines in dev, PII scrubbing for the few patterns that
 * we know to leak (full WebIDs, OIDC error detail, issue bodies in
 * agent logs). One dependency-free file so import paths stay simple and
 * Next.js's bundler doesn't have to learn about a new ESM/CJS quirk.
 *
 * Levels mirror the syslog set: trace < debug < info < warn < error.
 * Set the threshold with LOG_LEVEL=info (default). Set output format
 * with LOG_FORMAT=ndjson|text (default: ndjson in production, text
 * otherwise).
 *
 * Correlation IDs: a per-request id (set via `withCorrelationId`)
 * propagates through async work via AsyncLocalStorage so log lines from
 * the publisher / agents / git CGI can be traced back to the request
 * that triggered them. When no scope is active, the field is omitted.
 *
 * No correlation-id propagation across the post-receive boundary —
 * that's a different request, with its own id derived from the hook
 * payload.
 *
 * Note: this file is intentionally NOT `import "server-only"`. Even the
 * proxy.ts (edge runtime) imports nothing here; everything else is
 * server-side, but the module itself is dependency-free and safe in
 * either runtime.
 */

import { AsyncLocalStorage } from "node:async_hooks";

type Level = "trace" | "debug" | "info" | "warn" | "error";
type Format = "ndjson" | "text";

const LEVEL_RANK: Record<Level, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

function resolveLevel(): Level {
  const raw = (process.env.LOG_LEVEL ?? "").toLowerCase();
  if (raw in LEVEL_RANK) return raw as Level;
  return "info";
}

function resolveFormat(): Format {
  const raw = (process.env.LOG_FORMAT ?? "").toLowerCase();
  if (raw === "ndjson" || raw === "text") return raw;
  return process.env.NODE_ENV === "production" ? "ndjson" : "text";
}

const threshold = LEVEL_RANK[resolveLevel()];
const format = resolveFormat();

type CorrelationFrame = { id: string };
const correlationStore = new AsyncLocalStorage<CorrelationFrame>();

export function withCorrelationId<T>(id: string, fn: () => T): T {
  return correlationStore.run({ id }, fn);
}

export function currentCorrelationId(): string | null {
  return correlationStore.getStore()?.id ?? null;
}

/**
 * Scrub a value before it lands in a log line.
 *
 *  - WebIDs (http(s) URLs ending in `/profile/card#me` or similar) are
 *    collapsed to `<webid hash:abcd1234>` so the absolute URL — which
 *    is also the user's identifier — doesn't end up in shipped logs.
 *  - OIDC error detail blobs are clipped to 200 chars.
 *  - Other strings pass through.
 */
export function scrubWebId(webId: string | null | undefined): string {
  if (!webId) return "<none>";
  // 8-char shake based on string contents — stable, non-reversible.
  let h = 5381;
  for (let i = 0; i < webId.length; i++) h = ((h << 5) + h + webId.charCodeAt(i)) | 0;
  const hash = (h >>> 0).toString(16).padStart(8, "0");
  return `<webid ${hash}>`;
}

export function clip(s: string | null | undefined, max = 200): string {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max) + `…(+${s.length - max})`;
}

type LogFields = Record<string, unknown>;

function emit(level: Level, msg: string, fields?: LogFields): void {
  if (LEVEL_RANK[level] < threshold) return;
  const cid = currentCorrelationId();
  const ts = new Date().toISOString();
  if (format === "ndjson") {
    const line: Record<string, unknown> = {
      ts,
      level,
      msg,
      ...(cid ? { cid } : {}),
      ...(fields ?? {}),
    };
    // Avoid throwing on circular structures — fall back to a sentinel.
    let out: string;
    try {
      out = JSON.stringify(line);
    } catch {
      out = JSON.stringify({ ts, level, msg, error: "<unserialisable fields>" });
    }
    process.stdout.write(out + "\n");
    return;
  }
  // text mode
  const parts: string[] = [];
  parts.push(ts);
  parts.push(level.toUpperCase().padEnd(5));
  if (cid) parts.push(`cid=${cid}`);
  parts.push(msg);
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      parts.push(`${k}=${s}`);
    }
  }
  process.stdout.write(parts.join(" ") + "\n");
}

export const log = {
  trace: (msg: string, fields?: LogFields) => emit("trace", msg, fields),
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};

/** Generate a short correlation id (16 hex chars). Cheap, not crypto. */
export function newCorrelationId(): string {
  let s = "";
  for (let i = 0; i < 16; i++) {
    s += ((Math.random() * 16) | 0).toString(16);
  }
  return s;
}
