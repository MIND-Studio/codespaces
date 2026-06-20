import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import type { Repo } from "@/lib/registry/repos";
import { type MemberRole, ROLE_RANK, resolveMemberRole } from "@/lib/solid/members";

/**
 * Session cookie format:
 *
 *   mc-session = base64url(payload).base64url(sig)
 *
 * payload is JSON `{ webId, iat, exp, csrf }` (8-hour TTL).
 * sig is HMAC-SHA256 over the payload bytes, keyed by
 * BRIDGE_SESSION_SECRET. The CSRF nonce is mirrored into the
 * `mc-csrf` cookie (NOT HttpOnly) so client code can read and echo it
 * via the `X-CSRF-Token` header on state-changing requests
 * (double-submit pattern).
 */

const COOKIE_NAME = "mc-session";
const CSRF_COOKIE_NAME = "mc-csrf";
const SESSION_TTL_S = 8 * 60 * 60;

export type SessionPayload = {
  webId: string;
  iat: number;
  exp: number;
  csrf: string;
};

export type SessionInfo = {
  webId: string;
  csrf: string;
};

function b64urlEncode(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(pad), "base64");
}

function sign(payload: string, secret: Buffer): string {
  return b64urlEncode(createHmac("sha256", secret).update(payload).digest());
}

/** Constant-time string compare that doesn't leak length via early return. */
function secretEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal length; HMAC both sides to a fixed width so
  // a length mismatch doesn't short-circuit (and isn't itself a timing leak).
  const ah = createHmac("sha256", "len").update(ab).digest();
  const bh = createHmac("sha256", "len").update(bb).digest();
  return timingSafeEqual(ah, bh);
}

function isSecureRequest(): boolean {
  // Production cookies are always Secure. In dev, mark Secure only when
  // the request actually arrived over HTTPS (so localhost http stays
  // functional). Trust X-Forwarded-Proto from the reverse proxy.
  const env = getEnv();
  if (env.isProd) return true;
  // headers() must be awaited in newer Next, but isSecureRequest is
  // called only from inside route handlers where the caller has already
  // awaited headers(). We do a synchronous best-effort here by skipping
  // the proto check entirely in dev — local http loopback is fine.
  return false;
}

function encodeSession(p: SessionPayload, secret: Buffer): string {
  const payload = b64urlEncode(JSON.stringify(p));
  return `${payload}.${sign(payload, secret)}`;
}

function decodeSession(token: string, secret: Buffer): SessionPayload | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(b64urlDecode(payload).toString("utf-8")) as SessionPayload;
    if (typeof obj.webId !== "string") return null;
    if (typeof obj.exp !== "number" || obj.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

/**
 * Issue a fresh session cookie for a verified WebID. Called from the OIDC
 * callback handler once `completeAuthFlow` returns the resolved WebID.
 *
 * Sets BOTH the HttpOnly auth cookie and the readable CSRF mirror.
 */
export async function issueSession(webId: string): Promise<void> {
  const env = getEnv();
  const now = Math.floor(Date.now() / 1000);
  const csrf = randomBytes(16).toString("base64url");
  const payload: SessionPayload = {
    webId,
    iat: now,
    exp: now + SESSION_TTL_S,
    csrf,
  };
  const token = encodeSession(payload, env.sessionSecret);
  const jar = await cookies();
  const secure = env.isProd;
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S,
    secure,
  });
  jar.set(CSRF_COOKIE_NAME, csrf, {
    // NOT httpOnly — JS needs to read it and echo via X-CSRF-Token.
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_S,
    secure,
  });
}

/** Drop the session and CSRF cookies — used on /logout. */
export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  jar.delete(CSRF_COOKIE_NAME);
}

/** Returns the current session if cookies validate, else null. */
export async function readSession(): Promise<SessionInfo | null> {
  const env = getEnv();
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = decodeSession(token, env.sessionSecret);
  if (!payload) return null;
  return { webId: payload.webId, csrf: payload.csrf };
}

/** Verify CSRF: header X-CSRF-Token must equal the session's csrf nonce. */
async function verifyCsrf(session: SessionInfo): Promise<boolean> {
  const hdrs = await headers();
  const provided = hdrs.get("x-csrf-token") ?? "";
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(session.csrf);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type AuthFailure = {
  status: 401 | 403;
  body: { error: string; code: "UNAUTHENTICATED" | "FORBIDDEN" | "CSRF" };
};

function failure(
  status: AuthFailure["status"],
  code: AuthFailure["body"]["code"],
  message: string,
): NextResponse {
  return NextResponse.json({ error: message, code }, { status });
}

export type AuthOk = { webId: string };

/**
 * Require an authenticated session AND a valid CSRF token. Use on every
 * state-changing route (POST/PATCH/PUT/DELETE). Returns either an `ok`
 * branch with the session's WebID or a NextResponse the route should
 * return verbatim.
 *
 * Dev bypass: when `!getEnv().isProd` AND the request carries an
 * `X-Mind-Dev-WebId` header, that WebID is accepted as the session and
 * CSRF is waived. This keeps `npm run seed:demo` and ad-hoc curl flows
 * working without forcing every dev to drive the OIDC dance. The bypass
 * NEVER fires in production (`getEnv()` enforces this) and dev clients
 * still need network reach to the dev port, which is the same trust
 * assumption as before.
 */
export async function requireSession(opts?: {
  skipCsrf?: boolean;
}): Promise<{ ok: true; webId: string } | { ok: false; response: NextResponse }> {
  // Trusted-service bypass (prod-safe). A server-to-server caller (the builder
  // app) that presents the shared BRIDGE_SERVICE_SECRET may act on behalf of
  // any WebID. CSRF is waived (no browser cookies in play). Enabled only when
  // the operator sets BRIDGE_SERVICE_SECRET; the secret is compared in constant
  // time. The on-behalf-of WebID is asserted by the trusted caller — the bridge
  // does NOT re-verify it, so any holder of the secret is fully trusted.
  {
    const env = getEnv();
    if (env.serviceSecret) {
      const hdrs = await headers();
      const presented = hdrs.get("x-mind-service-secret");
      const onBehalfOf = hdrs.get("x-mind-on-behalf-of")?.trim();
      if (presented && onBehalfOf && secretEquals(presented, env.serviceSecret)) {
        return { ok: true, webId: onBehalfOf };
      }
    }
  }

  // Dev-only bypass (P0-S2 still gates the seeded *credential* path
  // separately — this just lets dev tools impersonate any WebID).
  if (!getEnv().isProd) {
    const hdrs = await headers();
    const devWebId = hdrs.get("x-mind-dev-webid");
    if (devWebId) {
      return { ok: true, webId: devWebId };
    }
  }

  const session = await readSession();
  if (!session) {
    return {
      ok: false,
      response: failure(401, "UNAUTHENTICATED", "no session; sign in via /connect"),
    };
  }
  if (!opts?.skipCsrf) {
    const ok = await verifyCsrf(session);
    if (!ok) {
      return {
        ok: false,
        response: failure(403, "CSRF", "missing or invalid X-CSRF-Token"),
      };
    }
  }
  return { ok: true, webId: session.webId };
}

/**
 * Like requireSession, but additionally requires the session's WebID to
 * equal `ownerWebId`. Use on routes where the URL identifies a resource
 * owned by a specific WebID (e.g. PATCH /api/repos/{o}/{r}). The
 * `ownerWebId` argument MUST come from the registry, not the request
 * body, otherwise the check is trivially bypassable.
 */
export async function requireOwner(
  ownerWebId: string,
): Promise<{ ok: true; webId: string } | { ok: false; response: NextResponse }> {
  const r = await requireSession();
  if (!r.ok) return r;
  if (r.webId !== ownerWebId) {
    return {
      ok: false,
      response: failure(403, "FORBIDDEN", "session WebID does not own this resource"),
    };
  }
  return r;
}

/**
 * Like requireOwner, but authorizes any repo **member** whose role meets
 * `minRole` (reader < writer < admin), per ADR-0002. The repo owner is an
 * implicit `admin` and is authorized without a pod read. A non-owner's role
 * is resolved from the pod-native `members.ttl` roster (read with the owner's
 * delegated fetch) — the bridge stays the sole writer; a member is a
 * capability the bridge enforces, not a WAC write-principal on the owner's
 * pod. CSRF + session checks are inherited from `requireSession`.
 *
 * Pass the **registry** `Repo` (not request-body fields), otherwise the
 * authorization target is attacker-controlled.
 */
export async function requireMember(
  repo: Repo,
  minRole: MemberRole,
): Promise<{ ok: true; webId: string } | { ok: false; response: NextResponse }> {
  const r = await requireSession();
  if (!r.ok) return r;
  // Owner short-circuit — implicit admin, no pod round-trip for the common case.
  if (r.webId === repo.ownerWebId) return r;
  const role = await resolveMemberRole(repo, r.webId);
  if (role && ROLE_RANK[role] >= ROLE_RANK[minRole]) return r;
  return {
    ok: false,
    response: failure(403, "FORBIDDEN", `requires '${minRole}' membership on this repo`),
  };
}

/**
 * Suppress unused-variable warnings.
 */
export { isSecureRequest };
