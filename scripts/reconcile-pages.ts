#!/usr/bin/env -S npx tsx
/**
 * One-shot reconciler. Compares each Pages-enabled repo's HEAD against
 * its `last_published_sha` and republishes on drift. Operator-friendly:
 * run from cron, a systemd timer, or by hand after a suspected hook
 * outage.
 *
 *   npm run reconcile:pages
 *
 * Exit code: 0 if every repo ended in {in-sync, republished, skipped-*},
 *            1 if at least one repo ended in {failed}.
 */
import { reconcilePages } from "@/lib/pages/reconciler";

async function main() {
  const outcomes = await reconcilePages();
  let failed = 0;
  for (const o of outcomes) {
    const head = o.headSha ? o.headSha.slice(0, 8) : "—";
    const pub = o.publishedSha ? o.publishedSha.slice(0, 8) : "—";
    const extra = o.error ? ` (${o.error})` : "";
    console.log(`  ${o.repo}: ${o.status} HEAD=${head} pub=${pub}${extra}`);
    if (o.status === "failed") failed += 1;
  }
  console.log(`reconciler: ${outcomes.length} repo(s) examined, ${failed} failure(s)`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("reconciler crashed:", e);
  process.exit(2);
});
