import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const DATA_DIR = process.env.REGISTRY_DATA_DIR ?? join(process.cwd(), ".registry-data");
const DB_PATH = join(DATA_DIR, "registry.db");
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");

const GLOBAL_KEY = "__mc_registry_db__";

declare global {
  // eslint-disable-next-line no-var
  var __mc_registry_db__: Database.Database | undefined;
}

export function getDb(): Database.Database {
  const cached = globalThis[GLOBAL_KEY];
  if (cached) return cached;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // 5s busy timeout: concurrent writers from the publisher / agents
  // dispatch / Git CGI all hit the registry; the WAL allows concurrent
  // readers but a checkpoint or schema-change can still surface
  // SQLITE_BUSY without this. P0-R6.
  db.pragma("busy_timeout = 5000");

  runMigrations(db);

  globalThis[GLOBAL_KEY] = db;
  return db;
}

export function closeDb(): void {
  const cached = globalThis[GLOBAL_KEY];
  if (cached) {
    try {
      cached.close();
    } catch {
      // discard
    }
    globalThis[GLOBAL_KEY] = undefined;
  }
}

function runMigrations(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migration (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);

  const applied = new Set(
    db
      .prepare("SELECT name FROM _migration")
      .all()
      .map((r) => (r as { name: string }).name),
  );

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO _migration (name, applied_at) VALUES (?, ?)").run(file, Date.now());
    });
    tx();
    console.log(`[registry] applied migration ${file}`);
  }
}
