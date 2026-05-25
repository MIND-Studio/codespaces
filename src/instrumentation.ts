// Next.js 16 `instrumentation.ts` — runs once per server start, before
// the first request lands. Used here to fire cross-cutting bootstrap
// (P0-R4 reconciler timer, future stuck-run reaper, future metrics
// registry). The actual init is in `src/lib/bootstrap.ts` so scripts and
// tests can call it directly without going through the Next runtime.
//
// Runtime check: Next executes this in both nodejs and edge runtimes.
// The reconciler imports `node:fs/promises` (via the publisher) and
// `child_process` (via git/backend), neither of which work in edge.
// `NEXT_RUNTIME === "nodejs"` is the documented gate.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { ensureServerBootstrap } = await import("@/lib/bootstrap");
  ensureServerBootstrap();
}
