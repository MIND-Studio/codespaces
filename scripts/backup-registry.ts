#!/usr/bin/env tsx
/**
 * Snapshot the registry SQLite DB using better-sqlite3's online
 * `Database#backup()` API. Safe to run while the bridge is writing.
 *
 * Usage:
 *   npm run backup:registry                   # writes to .backups/
 *   BACKUP_DIR=/srv/backups npm run backup:registry
 *
 * Pair with cron:
 *   0 * * * * cd /opt/mind-codespaces/codespaces && npm run backup:registry >> /var/log/mind-backup.log 2>&1
 *
 * Then ship the resulting .db files off-host nightly (rsync, S3, etc.).
 * Restore: stop the bridge, replace .registry-data/registry.db with the
 * snapshot, start the bridge — migrations are idempotent and the WAL is
 * checkpointed by the backup API.
 */
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

const REGISTRY_DIR = resolve(
  process.env.REGISTRY_DATA_DIR ?? join(process.cwd(), ".registry-data"),
);
const REGISTRY_DB = join(REGISTRY_DIR, "registry.db");
const BACKUP_DIR = resolve(
  process.env.BACKUP_DIR ?? join(process.cwd(), ".backups"),
);
const RETAIN = Number(process.env.BACKUP_RETAIN_COUNT ?? "24");

async function main(): Promise<void> {
  if (!existsSync(REGISTRY_DB)) {
    console.error(`[backup] no registry DB at ${REGISTRY_DB}`);
    process.exit(1);
  }
  if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  const out = join(BACKUP_DIR, `registry-${stamp}.db`);
  console.log(`[backup] ${REGISTRY_DB} -> ${out}`);

  const db = new Database(REGISTRY_DB, { readonly: true, fileMustExist: true });
  try {
    await db.backup(out);
  } finally {
    db.close();
  }
  const stat = statSync(out);
  console.log(`[backup] wrote ${stat.size} bytes`);

  // Retention: keep the N most recent snapshots.
  const snapshots = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith("registry-") && f.endsWith(".db"))
    .map((f) => ({ f, ts: statSync(join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.ts - a.ts);
  for (const s of snapshots.slice(RETAIN)) {
    try {
      unlinkSync(join(BACKUP_DIR, s.f));
      console.log(`[backup] pruned ${s.f}`);
    } catch (e) {
      console.warn(`[backup] failed to prune ${s.f}:`, (e as Error).message);
    }
  }
}

main().catch((err) => {
  console.error("[backup] failed:", err);
  process.exit(1);
});
