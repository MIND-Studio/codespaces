/**
 * Dev helper: point a user's coder at a specific (provider, model) using the
 * encrypted BYOK vault — the same rows the /profile/ai-providers UI writes.
 *
 * Self-contained (no `server-only` imports, so it runs under tsx): it opens
 * the registry DB directly and replicates store.ts's AES-256-GCM envelope
 * (v1:iv:tag:ct) using the bridge's own IDENTITY_ENCRYPTION_KEY, so the
 * running bridge decrypts the key at coder-run time.
 *
 * Usage:
 *   # list users that own repos + their current coder config
 *   tsx scripts/set-coder-provider.ts
 *
 *   # set google/gemini-3.1-flash-lite for a user (key via env, never argv)
 *   GEMINI_SETUP_KEY=… tsx scripts/set-coder-provider.ts <webId> google gemini-3.1-flash-lite
 */
import Database from "better-sqlite3";
import { createCipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROVIDERS = ["openrouter", "google", "anthropic", "openai"] as const;
type ProviderName = (typeof PROVIDERS)[number];

const DATA_DIR = process.env.REGISTRY_DATA_DIR ?? join(process.cwd(), ".registry-data");
const DB_PATH = join(DATA_DIR, "registry.db");

function encryptionKey(): Buffer {
  const raw = process.env.IDENTITY_ENCRYPTION_KEY;
  if (raw) {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === 32) return b64;
    throw new Error("IDENTITY_ENCRYPTION_KEY must be 32 bytes hex or base64");
  }
  // dev: the synthesised secret persisted by env.ts
  const secrets = JSON.parse(
    readFileSync(join(DATA_DIR, ".bridge-secrets.json"), "utf-8"),
  ) as { identityEncryptionKey?: string };
  if (!secrets.identityEncryptionKey) {
    throw new Error("no identityEncryptionKey in .bridge-secrets.json");
  }
  return Buffer.from(secrets.identityEncryptionKey, "hex");
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

function makeHint(plaintext: string): string {
  const t = plaintext.trim();
  return t.length <= 4 ? "•".repeat(t.length) : `…${t.slice(-4)}`;
}

const db = new Database(DB_PATH);

function listOwners(): void {
  const rows = db
    .prepare(
      "SELECT DISTINCT owner_webid AS webId FROM repos WHERE owner_webid IS NOT NULL ORDER BY owner_webid",
    )
    .all() as Array<{ webId: string }>;
  if (!rows.length) {
    console.log("(no repos with an owner_webid found)");
    return;
  }
  console.log("Repo owners (candidate webIds):\n");
  for (const r of rows) {
    const pref = db
      .prepare("SELECT provider, model FROM user_ai_prefs WHERE web_id = ?")
      .get(r.webId) as { provider: string | null; model: string | null } | undefined;
    const keys = (
      db
        .prepare("SELECT provider FROM user_ai_providers WHERE web_id = ?")
        .all(r.webId) as Array<{ provider: string }>
    )
      .map((k) => k.provider)
      .join(",") || "none";
    const using =
      pref?.provider && pref.model
        ? `${pref.provider}/${pref.model} (user-pref)`
        : `env-fallback (${process.env.MIND_AGENT_MODEL ?? "qwen/qwen3-coder:free"})`;
    console.log(`  ${r.webId}`);
    console.log(`      keys: ${keys} | coder uses: ${using}`);
  }
}

const [, , webId, provider, model] = process.argv;

if (!webId) {
  listOwners();
  process.exit(0);
}
if (!PROVIDERS.includes(provider as ProviderName)) {
  console.error(`provider must be one of ${PROVIDERS.join("|")} (got ${provider})`);
  process.exit(1);
}
if (!model) {
  console.error("model id is required");
  process.exit(1);
}
const apiKey = process.env.GEMINI_SETUP_KEY;
if (!apiKey || apiKey.trim().length < 8) {
  console.error("set GEMINI_SETUP_KEY in the environment (the provider API key)");
  process.exit(1);
}

const key = encryptionKey();
const now = Date.now();
db.prepare(
  `INSERT INTO user_ai_providers (web_id, provider, api_key_enc, hint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(web_id, provider) DO UPDATE
       SET api_key_enc = excluded.api_key_enc, hint = excluded.hint, updated_at = excluded.updated_at`,
).run(webId, provider, encrypt(apiKey.trim(), key), makeHint(apiKey), now, now);
db.prepare(
  `INSERT INTO user_ai_prefs (web_id, provider, model, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(web_id) DO UPDATE
       SET provider = excluded.provider, model = excluded.model, updated_at = excluded.updated_at`,
).run(webId, provider, model.trim(), now);

console.log(`✓ stored ${provider} key for ${webId} (hint ${makeHint(apiKey)})`);
console.log(`✓ set coder pref → ${provider}/${model}`);
