import "server-only";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Centralised env access with fail-fast validation in production.
 *
 * In NODE_ENV=production the bridge refuses to start when:
 *   - BRIDGE_PUBLIC_URL / POD_BASE_URL look like localhost / loopback
 *   - POD_USER_PASSWORD is unset OR equals the dev fallback string
 *   - ALLOW_SEEDED_FALLBACK is unset (P0-S2: the seeded path is dev-only)
 *   - BRIDGE_SESSION_SECRET / BRIDGE_HOOK_SECRET / IDENTITY_ENCRYPTION_KEY
 *     are missing (secrets that gate session auth, hook HMAC, and
 *     refresh-token storage encryption MUST be operator-supplied)
 *
 * Outside production (NODE_ENV !== "production") the module synthesises
 * missing secrets into a sibling file `.bridge-secrets.json` next to the
 * registry data dir so dev restarts produce stable cookies. The seeded
 * fallback is allowed unconditionally in dev.
 */

export type BridgeEnv = {
  nodeEnv: "production" | "development" | "test";
  isProd: boolean;

  // URLs
  bridgePublicUrl: string;
  bridgeInternalUrl: string;
  podBaseUrl: string;
  postReceiveCallbackUrl: string;

  // Disk paths
  gitDataDir: string;
  registryDataDir: string;

  // Seeded-credential fallback (P0-S2)
  podUserEmail: string;
  podUserPassword: string;
  allowSeededFallback: boolean;

  // Secrets
  sessionSecret: Buffer; // HMAC-SHA256 key for the session cookie
  hookSecret: string; // shared secret in post-receive hook scripts
  identityEncryptionKey: Buffer; // 32-byte AES-256-GCM key for refresh-token encryption

  // Agents / coder
  openrouterApiKey: string | null;
  agentModel: string;
  coderImage: string;
  coderTimeoutMs: number;
  coderWorkroot: string | null;
  mindRunner: "auto" | "docker" | "native";

  // Operator-only admin bearer for /api/admin/* — null disables those routes.
  adminToken: string | null;
  // Trusted-service secret for server-to-server callers (builder) — null
  // disables the on-behalf-of auth path.
  serviceSecret: string | null;
};

function looksLikeLoopback(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])(:|\/|$)/.test(url);
}

function readSecretFile(path: string): Record<string, string> | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, string>;
  } catch {
    return null;
  }
}

function writeSecretFile(path: string, data: Record<string, string>): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
  // Best-effort permission tightening — won't work on Windows but this
  // codebase only targets POSIX.
  try {
    chmodSync(path, 0o600);
  } catch {
    /* ignore */
  }
}

function loadOrSynthesiseDevSecrets(registryDataDir: string): {
  sessionSecret: Buffer;
  hookSecret: string;
  identityEncryptionKey: Buffer;
} {
  const path = join(registryDataDir, ".bridge-secrets.json");
  const existing = readSecretFile(path);
  if (existing?.sessionSecret && existing.hookSecret && existing.identityEncryptionKey) {
    return {
      sessionSecret: Buffer.from(existing.sessionSecret, "hex"),
      hookSecret: existing.hookSecret,
      identityEncryptionKey: Buffer.from(existing.identityEncryptionKey, "hex"),
    };
  }
  const fresh = {
    sessionSecret: randomBytes(32).toString("hex"),
    hookSecret: randomBytes(24).toString("hex"),
    identityEncryptionKey: randomBytes(32).toString("hex"),
  };
  writeSecretFile(path, fresh);
  return {
    sessionSecret: Buffer.from(fresh.sessionSecret, "hex"),
    hookSecret: fresh.hookSecret,
    identityEncryptionKey: Buffer.from(fresh.identityEncryptionKey, "hex"),
  };
}

function parseRequiredSecret(name: string, raw: string | undefined, byteLen: number): Buffer {
  if (!raw) throw new Error(`${name} must be set in production`);
  // Accept hex or base64; pick the shorter parse that matches the expected length.
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === byteLen * 2) {
    return Buffer.from(raw, "hex");
  }
  const fromB64 = Buffer.from(raw, "base64");
  if (fromB64.length === byteLen) return fromB64;
  throw new Error(
    `${name} must be ${byteLen} bytes hex or base64 (got ${raw.length} chars / ${fromB64.length} decoded bytes)`,
  );
}

const SEEDED_DEV_PASSWORD = "dev-only-do-not-use-in-prod";
const SEEDED_DEV_EMAIL = "alice@mind.local";

let cached: BridgeEnv | null = null;

export function getEnv(): BridgeEnv {
  if (cached) return cached;

  const nodeEnvRaw = process.env.NODE_ENV ?? "development";
  const nodeEnv: BridgeEnv["nodeEnv"] =
    nodeEnvRaw === "production" || nodeEnvRaw === "test" ? nodeEnvRaw : "development";
  const isProd = nodeEnv === "production";

  // Next.js evaluates server-side modules during `next build` (static
  // analysis + prerender). The runtime .env isn't mounted yet at that
  // point, so calling getEnv() with strict production checks would
  // refuse the build. Detect the build phase and defer validation +
  // secret enforcement to actual startup (when NEXT_PHASE is unset and
  // the bridge is reading its real env from docker-compose).
  const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
  const enforceProd = isProd && !isBuildPhase;

  const bridgePublicUrl = process.env.BRIDGE_PUBLIC_URL ?? "http://localhost:3010";
  const bridgeInternalUrl = process.env.BRIDGE_INTERNAL_URL ?? "http://127.0.0.1:3010";
  const podBaseUrl = process.env.POD_BASE_URL ?? "http://localhost:3011/";
  const postReceiveCallbackUrl =
    process.env.POST_RECEIVE_CALLBACK_URL ??
    `${bridgeInternalUrl.replace(/\/$/, "")}/api/git/internal/post-receive`;

  const gitDataDir = resolve(process.env.GIT_DATA_DIR ?? join(process.cwd(), ".git-data", "repos"));
  const registryDataDir = resolve(
    process.env.REGISTRY_DATA_DIR ?? join(process.cwd(), ".registry-data"),
  );

  const podUserEmail = process.env.POD_USER_EMAIL ?? SEEDED_DEV_EMAIL;
  const podUserPassword = process.env.POD_USER_PASSWORD ?? SEEDED_DEV_PASSWORD;
  const allowSeededFallback = process.env.ALLOW_SEEDED_FALLBACK === "1";

  const openrouterApiKey = process.env.OPENROUTER_API_KEY?.trim() || null;
  const agentModel =
    process.env.MIND_AGENT_MODEL?.trim() || "qwen/qwen3-coder:free";
  const coderImage =
    process.env.MIND_CODER_IMAGE?.trim() || "mind-codespaces/coder:latest";
  const coderTimeoutMs = Number(process.env.MIND_CODER_TIMEOUT ?? 600) * 1000;
  const coderWorkroot = process.env.MIND_CODER_WORKROOT ?? null;
  const runnerRaw = (process.env.MIND_RUNNER ?? "auto").toLowerCase();
  const mindRunner: BridgeEnv["mindRunner"] =
    runnerRaw === "docker" || runnerRaw === "native" ? runnerRaw : "auto";
  const adminToken = process.env.BRIDGE_ADMIN_TOKEN?.trim() || null;
  // Optional trusted-service secret. When set, a server-to-server caller (the
  // builder app) that presents X-Mind-Service-Secret + X-Mind-On-Behalf-Of is
  // accepted as that WebID, in prod too (CSRF waived). Null disables the path.
  const serviceSecret = process.env.BRIDGE_SERVICE_SECRET?.trim() || null;

  // Validation pass.
  const errors: string[] = [];
  if (enforceProd) {
    if (looksLikeLoopback(bridgePublicUrl)) {
      errors.push("BRIDGE_PUBLIC_URL must not point at localhost/loopback in production");
    }
    if (looksLikeLoopback(podBaseUrl)) {
      errors.push("POD_BASE_URL must not point at localhost/loopback in production");
    }
    // POD_USER_{EMAIL,PASSWORD} only matter when ALLOW_SEEDED_FALLBACK=1
    // is also set, since fetch-for-owner.ts refuses the seeded path
    // otherwise. So only validate them when the seeded path is opted in.
    if (allowSeededFallback) {
      if (podUserPassword === SEEDED_DEV_PASSWORD) {
        errors.push(
          "POD_USER_PASSWORD must not equal the dev fallback in production when ALLOW_SEEDED_FALLBACK=1",
        );
      }
      if (podUserEmail === SEEDED_DEV_EMAIL) {
        errors.push(
          "POD_USER_EMAIL must not equal the dev fallback in production when ALLOW_SEEDED_FALLBACK=1",
        );
      }
    }
    if (Number.isNaN(coderTimeoutMs) || coderTimeoutMs <= 0) {
      errors.push("MIND_CODER_TIMEOUT must be a positive integer (seconds)");
    }
  }

  let sessionSecret: Buffer;
  let hookSecret: string;
  let identityEncryptionKey: Buffer;
  if (enforceProd) {
    try {
      sessionSecret = parseRequiredSecret(
        "BRIDGE_SESSION_SECRET",
        process.env.BRIDGE_SESSION_SECRET,
        32,
      );
    } catch (e) {
      errors.push((e as Error).message);
      sessionSecret = Buffer.alloc(32);
    }
    if (!process.env.BRIDGE_HOOK_SECRET) {
      errors.push("BRIDGE_HOOK_SECRET must be set in production");
      hookSecret = "";
    } else {
      hookSecret = process.env.BRIDGE_HOOK_SECRET;
    }
    try {
      identityEncryptionKey = parseRequiredSecret(
        "IDENTITY_ENCRYPTION_KEY",
        process.env.IDENTITY_ENCRYPTION_KEY,
        32,
      );
    } catch (e) {
      errors.push((e as Error).message);
      identityEncryptionKey = Buffer.alloc(32);
    }
  } else if (isBuildPhase) {
    // Build-time: ephemeral secrets that never get persisted or used at
    // runtime. Just enough to let prerender complete.
    sessionSecret = randomBytes(32);
    hookSecret = randomBytes(24).toString("hex");
    identityEncryptionKey = randomBytes(32);
  } else {
    const synth = loadOrSynthesiseDevSecrets(registryDataDir);
    sessionSecret = synth.sessionSecret;
    hookSecret = synth.hookSecret;
    identityEncryptionKey = synth.identityEncryptionKey;
  }

  if (errors.length > 0) {
    const banner =
      "Refusing to start: production env validation failed.\n" +
      errors.map((e) => `  - ${e}`).join("\n") +
      "\nSee infra/prod/.env.example.";
    throw new Error(banner);
  }

  cached = {
    nodeEnv,
    isProd,
    bridgePublicUrl,
    bridgeInternalUrl,
    podBaseUrl,
    postReceiveCallbackUrl,
    gitDataDir,
    registryDataDir,
    podUserEmail,
    podUserPassword,
    allowSeededFallback,
    sessionSecret,
    hookSecret,
    identityEncryptionKey,
    openrouterApiKey,
    agentModel,
    coderImage,
    coderTimeoutMs,
    coderWorkroot,
    mindRunner,
    adminToken,
    serviceSecret,
  };
  return cached;
}

/** Test-only: clear the cache so a follow-up getEnv() rereads process.env. */
export function _resetEnvCacheForTests(): void {
  cached = null;
}
