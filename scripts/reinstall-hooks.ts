#!/usr/bin/env tsx
/**
 * Rewrite the `post-receive` hook in every existing bare repo under
 * GIT_DATA_DIR. Use this after rotating `BRIDGE_HOOK_SECRET` or changing
 * `BRIDGE_INTERNAL_URL` — the hook bakes both values at write time.
 *
 *   npm run reinstall:hooks
 */
import { reinstallAllHooks, getGitDataDir } from "@/lib/git/backend";

async function main(): Promise<void> {
  console.log(`[reinstall-hooks] scanning ${getGitDataDir()}`);
  const { count } = await reinstallAllHooks();
  console.log(`[reinstall-hooks] rewrote ${count} post-receive hook(s)`);
}

main().catch((err) => {
  console.error("[reinstall-hooks] failed:", err);
  process.exit(1);
});
