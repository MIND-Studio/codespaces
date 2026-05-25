/**
 * Pure formatting helpers that work in both server and client components.
 * Keep this dependency-free (no server-only import) so the same module
 * can be reused everywhere — the values it produces are deterministic
 * given the inputs.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Compact, human-readable "time since" string. Renders as "12s ago",
 * "5m ago", "3h ago", "2d ago", "3w ago", "4mo ago", "2y ago". For
 * timestamps in the future (e.g. clock skew on a freshly-created row),
 * collapses to "just now" rather than emitting nonsense.
 */
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 5 * SECOND) return "just now";
  if (diff < MINUTE) return `${Math.floor(diff / SECOND)}s ago`;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
  if (diff < MONTH) return `${Math.floor(diff / WEEK)}w ago`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo ago`;
  return `${Math.floor(diff / YEAR)}y ago`;
}

/** ISO-with-space form for tooltips: `2026-05-23 11:12:36Z`. */
export function formatAbsoluteIso(ts: number): string {
  return new Date(ts).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

/** `1.8s`, `12.4s`. Returns `—` when finishedAt is null. */
export function formatDuration(startedAt: number, finishedAt: number | null): string {
  if (finishedAt == null) return "—";
  const seconds = (finishedAt - startedAt) / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}
