import "server-only";
import { headers } from "next/headers";
import { NextResponse } from "next/server";

/**
 * In-memory token-bucket rate limiter. Single-process scope — the
 * bridge today is one Next.js server so this is sufficient; multi-node
 * deployments will need a shared backend (Redis / SQLite). See P0-S8.
 *
 * Each bucket has `capacity` tokens and refills at `refillPerSec` per
 * second. A request consumes 1 token. Empty bucket → reject with 429.
 */

type Bucket = { tokens: number; lastFillMs: number };
const buckets = new Map<string, Bucket>();

export type RateLimitConfig = {
  /** Bucket capacity (burst size). */
  capacity: number;
  /** Refill rate in tokens per second. */
  refillPerSec: number;
};

function take(key: string, cfg: RateLimitConfig): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: cfg.capacity, lastFillMs: now };
    buckets.set(key, b);
  } else {
    const elapsed = (now - b.lastFillMs) / 1000;
    b.tokens = Math.min(cfg.capacity, b.tokens + elapsed * cfg.refillPerSec);
    b.lastFillMs = now;
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

/**
 * Derive a per-client key from the request. Honors X-Forwarded-For
 * (the prod Caddy sets it), falls back to the cookie session WebID,
 * else "anonymous". The fallback is intentionally coarse — a logged-out
 * client behind a NAT shares a bucket with all of them, which is OK for
 * brute-force-of-token-mint defense.
 */
async function clientKey(scope: string): Promise<string> {
  const hdrs = await headers();
  const fwd = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = hdrs.get("x-real-ip");
  const ip = fwd || real || "anonymous";
  return `${scope}:${ip}`;
}

/**
 * Enforce a rate limit. Returns null when allowed; otherwise returns a
 * pre-built 429 NextResponse the caller can return directly.
 */
export async function rateLimit(
  scope: string,
  cfg: RateLimitConfig,
): Promise<NextResponse | null> {
  const key = await clientKey(scope);
  if (take(key, cfg)) return null;
  return NextResponse.json(
    { error: "rate limited", code: "RATE_LIMITED" },
    {
      status: 429,
      headers: { "Retry-After": "5" },
    },
  );
}

/**
 * Failure-counting variant. The bucket starts full (capacity = how many
 * failures are tolerated before lockout); `recordFailure` consumes one
 * token. `isLockedOut` peeks without consuming. Tokens refill at
 * `refillPerSec`, so the lockout self-heals over time.
 *
 * Use for auth-failure brute-force defense: peek before attempting auth,
 * consume only when auth fails. A successful credential burns no budget.
 */
export async function isLockedOut(
  scope: string,
  cfg: RateLimitConfig,
): Promise<boolean> {
  const key = await clientKey(scope);
  const now = Date.now();
  const b = buckets.get(key);
  if (!b) return false;
  const elapsed = (now - b.lastFillMs) / 1000;
  const projected = Math.min(cfg.capacity, b.tokens + elapsed * cfg.refillPerSec);
  return projected < 1;
}

export async function recordFailure(
  scope: string,
  cfg: RateLimitConfig,
): Promise<void> {
  const key = await clientKey(scope);
  take(key, cfg);
}

export const RATE_LIMITS = {
  // Token mint is the highest-risk one — a stolen session could otherwise
  // pump out tokens to lock in long-lived access. 5 / 30s.
  tokenMint: { capacity: 5, refillPerSec: 5 / 30 },
  // Repo create — modest cap so a single client can't flood the registry.
  // 10 / minute.
  repoCreate: { capacity: 10, refillPerSec: 10 / 60 },
  // Issue create — guards against agent-dispatch budget exhaustion via
  // mass-filed issues. 20 / minute.
  issueCreate: { capacity: 20, refillPerSec: 20 / 60 },
  // Issue proposal — the *public* propose endpoint, so this is the main
  // abuse control on an unauthenticated write into the owner's pod inbox.
  // Deliberately tight: 5 burst, ~1/min refill, keyed per IP.
  proposalCreate: { capacity: 5, refillPerSec: 1 / 60 },
  // OIDC start — guards against issuer-discovery probing. 10 / 30s.
  authStart: { capacity: 10, refillPerSec: 10 / 30 },
  // Agent dispatch — burns LLM budget. 5 / 30s per IP.
  agentDispatch: { capacity: 5, refillPerSec: 5 / 30 },
  // Push-token auth failures. Capacity 10 failures, refill ~1/min — so
  // after 10 wrong tokens an attacker is locked out for ~10 minutes per
  // (repo, IP). Scoped per-repo so brute-forcing repo A doesn't lock the
  // legitimate owner of repo B sharing the same NAT.
  gitPushAuthFailure: { capacity: 10, refillPerSec: 1 / 60 },
} satisfies Record<string, RateLimitConfig>;
