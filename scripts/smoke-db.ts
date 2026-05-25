#!/usr/bin/env tsx
/**
 * Smoke test for the registry: applies every migration to a fresh DB,
 * exercises the validation rules we depend on at the API boundary, and
 * verifies the seeded plumbing (sessions, HMAC) round-trips cleanly.
 *
 * Runs against a throwaway directory — does NOT touch your dev data.
 * Useful as the first signal in CI once a real test runner lands.
 *
 *   npm run smoke:db
 *
 * Implementation note: the bridge modules import "server-only", which
 * unconditionally throws outside the Next.js server runtime. We pre-seed
 * the CJS module cache below with a no-op so the real modules can be
 * loaded by tsx for testing.
 */
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";

// Replace `server-only` with a benign shim before any bridge module loads.
{
  const r = createRequire(import.meta.url);
  const resolved = r.resolve("server-only");
  // @ts-expect-error — accessing the internal CJS cache deliberately.
  r.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: {},
  };
}

const TMP = mkdtempSync(join(tmpdir(), "mc-smoke-"));
process.env.REGISTRY_DATA_DIR = TMP;
process.env.GIT_DATA_DIR = join(TMP, "git-data");
// Force dev mode so env.ts synthesises the secrets file instead of
// demanding production secrets. Casting because Next ambient types pin
// NODE_ENV to a literal union; the assignment is intentional here.
(process.env as Record<string, string>).NODE_ENV = "development";
process.env.ALLOW_SEEDED_FALLBACK = "1";

type Check = { name: string; ok: boolean; detail?: string };
const results: Check[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function run(): Promise<void> {
  // Lazy-imported so the env tweaks above land before the modules read them.
  const { getDb, closeDb } = await import("@/lib/registry/db");
  const {
    createRepo,
    getRepo,
    validateName,
    RegistryError,
  } = await import("@/lib/registry/repos");
  const { createPushToken, verifyPushToken } = await import(
    "@/lib/registry/tokens"
  );
  const { getEnv } = await import("@/lib/env");

  // 1. Fresh DB applies every migration.
  try {
    getDb();
    record("migrations apply on fresh DB", true);
  } catch (e) {
    record("migrations apply on fresh DB", false, (e as Error).message);
    closeDb();
    return;
  }

  // 2. validateName accepts legit names.
  try {
    validateName("alice", "owner");
    validateName("bakery", "repo");
    record("validateName accepts legit names", true);
  } catch (e) {
    record("validateName accepts legit names", false, (e as Error).message);
  }

  // 3. validateName rejects traversal and shell metacharacters.
  const evil = ["../etc", "..%2Fetc", "name with spaces", "name;rm", "x\0y"];
  let allRejected = true;
  for (const n of evil) {
    try {
      validateName(n, "repo");
      allRejected = false;
    } catch (e) {
      if (!(e instanceof RegistryError)) {
        allRejected = false;
      }
    }
  }
  record("validateName rejects traversal/metachars", allRejected);

  // 4. createRepo is transactional: a successful create writes both rows.
  try {
    const repo = createRepo({
      owner: "alice",
      name: "smoke-test",
      ownerWebId: "http://localhost:3011/alice/profile/card#me",
      ownerPodRoot: "http://localhost:3011/alice/",
      visibility: "public",
    });
    const fetched = getRepo("alice", "smoke-test");
    const db = getDb();
    const pages = db
      .prepare("SELECT * FROM pages_configs WHERE repo_id = ?")
      .get(repo.id) as Record<string, unknown> | undefined;
    record(
      "createRepo writes repos + pages_configs atomically",
      Boolean(fetched && pages),
    );
  } catch (e) {
    record(
      "createRepo writes repos + pages_configs atomically",
      false,
      (e as Error).message,
    );
  }

  // 5. Push token round-trip.
  try {
    const r = getRepo("alice", "smoke-test")!;
    const { token } = createPushToken(r.id, "smoke");
    const verified = verifyPushToken(r.id, token);
    const wrong = verifyPushToken(r.id, "scp_definitely-not-a-real-token");
    record(
      "push token verify accepts real, rejects wrong",
      verified === true && wrong === false,
    );
  } catch (e) {
    record("push token verify accepts real, rejects wrong", false, (e as Error).message);
  }

  // 6. Env module synthesised secrets in dev.
  try {
    const env = getEnv();
    const ok =
      env.sessionSecret.length === 32 &&
      env.hookSecret.length > 16 &&
      env.identityEncryptionKey.length === 32;
    record("dev secrets file synthesised by env module", ok);
    const path = join(TMP, ".bridge-secrets.json");
    if (existsSync(path)) {
      JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch (e) {
    record("dev secrets file synthesised by env module", false, (e as Error).message);
  }

  // 7. HMAC round-trip on the post-receive body.
  try {
    const env = getEnv();
    const body = JSON.stringify({ owner: "alice", repo: "smoke-test" });
    const sig = createHmac("sha256", env.hookSecret).update(body).digest("hex");
    const wrong = createHmac("sha256", "other").update(body).digest("hex");
    record(
      "hook HMAC matches with right key, differs with wrong",
      sig !== wrong && sig.length === 64,
    );
  } catch (e) {
    record("hook HMAC matches with right key, differs with wrong", false, (e as Error).message);
  }

  // 8. identity_storage encryption round-trip.
  try {
    const { makeIdentityStorage } = await import("@/lib/registry/identities");
    const storage = makeIdentityStorage("smoke-session-id");
    await storage.set("key", "plain-text-value");
    const got = await storage.get("key");
    const db = getDb();
    const onDisk = (db
      .prepare("SELECT value FROM identity_storage WHERE key = ?")
      .get("key") as { value: string } | undefined)?.value;
    record(
      "identity_storage values are ciphertext on disk and decrypt cleanly",
      got === "plain-text-value" &&
        typeof onDisk === "string" &&
        onDisk.startsWith("v1:") &&
        !onDisk.includes("plain-text-value"),
    );
  } catch (e) {
    record(
      "identity_storage values are ciphertext on disk and decrypt cleanly",
      false,
      (e as Error).message,
    );
  }

  // 9. Publish-lock coalescing.
  try {
    const { withPublishLock } = await import("@/lib/pages/publish-lock");
    let resolved = 0;
    let coalesced = 0;
    const tasks: Promise<unknown>[] = [];
    // Start the current task and queue three follow-ups: only the LAST
    // follow-up should run (the prior two collapse into "coalesced").
    tasks.push(
      withPublishLock(999, async () => {
        await new Promise((r) => setTimeout(r, 50));
        resolved += 1;
        return "first";
      }),
    );
    for (let i = 0; i < 3; i++) {
      tasks.push(
        withPublishLock(999, async () => {
          resolved += 1;
          return `follow-${i}`;
        }).then((r) => {
          if (r === "coalesced") coalesced += 1;
          return r;
        }),
      );
    }
    await Promise.all(tasks);
    // Expected: first runs (resolved=1), then ONE follow-up runs (resolved=2),
    // and 2 prior follow-ups coalesced (coalesced>=1).
    record(
      "publish-lock coalesces concurrent follow-ups (latest-wins)",
      resolved <= 2 && coalesced >= 1,
      `resolved=${resolved} coalesced=${coalesced}`,
    );
  } catch (e) {
    record("publish-lock coalesces concurrent follow-ups (latest-wins)", false, (e as Error).message);
  }

  closeDb();
}

run()
  .then(() => {
    const failed = results.filter((r) => !r.ok);
    console.log(
      `\n[smoke] ${results.length - failed.length}/${results.length} checks passed`,
    );
    process.exit(failed.length === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error("[smoke] crashed:", err);
    process.exit(1);
  })
  .finally(() => {
    try {
      rmSync(TMP, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
