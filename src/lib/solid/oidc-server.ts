import "server-only";
import { randomUUID } from "node:crypto";
import { Session, getSessionFromStorage } from "@inrupt/solid-client-authn-node";
import {
  getIdentityByWebId,
  makeIdentityStorage,
  saveIdentity,
} from "@/lib/registry/identities";
import { getEnv } from "@/lib/env";
import { log, scrubWebId } from "@/lib/log";

const CLIENT_NAME = "Mind Codespaces";

/**
 * Thrown when a WebID has a stored identity but the OIDC session can no
 * longer be refreshed (refresh token expired / revoked). The caller MUST
 * surface "needs reauthorization" rather than silently falling back to
 * seeded credentials. See P0-R2 in PRODUCTION-READINESS.md.
 */
export class OidcRefreshFailedError extends Error {
  constructor(public readonly webId: string) {
    super(`OIDC refresh failed for WebID ${webId}; reauthorize via /connect`);
    this.name = "OidcRefreshFailedError";
  }
}

/**
 * In-process cache of live, authenticated `fetch`es keyed by WebID (MC-176).
 *
 * Why this exists — the actual bug: `loadAuthedFetchForWebId` used to call
 * `getSessionFromStorage(..., { refreshSession: true })` on EVERY publish,
 * forcing the SDK to spend the stored refresh token against the IdP each time.
 * Solid pods (CSS) issue **single-use** refresh tokens, so the pattern was:
 * publish #1 refreshes (token consumed, a new one stored), publish #2 races/
 * reuses and the IdP rejects it → `isLoggedIn:false` → "refresh token failed",
 * forever. That's exactly the reported "fails after one successful publish".
 *
 * The fix is to refresh only when we actually need a new access token: we keep
 * the freshly-authenticated session's `fetch` in memory until just before the
 * access token expires, and hand the same one back for subsequent publishes.
 * Refreshes drop from once-per-publish to roughly once-per-token-lifetime, so
 * the single-use refresh token is no longer burned on every request.
 *
 * Invalidation: an entry is dropped when the WebID re-`/connect`s (the
 * `sessionId` changes) or when the cached access token nears expiry. The cache
 * is per-process and best-effort — losing it only forces one extra refresh.
 */
type CachedSession = {
  sessionId: string;
  fetch: typeof fetch;
  expiresAt: number; // ms epoch; 0 means "unknown — treat as already expired"
};
const sessionCache = new Map<string, CachedSession>();

// Re-derive the access token this long before it actually expires, so an
// in-flight request never rides a token that lapses mid-publish.
const TOKEN_EXPIRY_SKEW_MS = 60_000;

/** Drop any cached session for a WebID (call on disconnect / forced re-auth). */
export function clearCachedSession(webId: string): void {
  sessionCache.delete(webId);
}

/**
 * Begin a Solid-OIDC authorization-code flow. Returns the URL the user
 * should be redirected to (the issuer's auth endpoint) and the session
 * ID we'll need at callback time to resume the flow.
 *
 * The Inrupt SDK handles dynamic client registration, PKCE, DPoP, and
 * persists all per-session state into the provided IStorage. We hand it
 * a SQLite-backed storage keyed by a fresh session ID so the callback
 * (a separate HTTP request, possibly on a different worker) can rehydrate.
 */
export async function startAuthFlow(input: {
  oidcIssuer: string;
}): Promise<{ sessionId: string; redirectUrl: string }> {
  const sessionId = randomUUID();
  const storage = makeIdentityStorage(sessionId);
  const session = new Session({ storage }, sessionId);

  let captured: string | null = null;
  await session.login({
    oidcIssuer: input.oidcIssuer,
    redirectUrl: `${getEnv().bridgePublicUrl}/api/auth/callback`,
    clientName: CLIENT_NAME,
    tokenType: "DPoP",
    handleRedirect: (url) => {
      captured = url;
    },
  });
  if (!captured) {
    throw new Error(
      "OIDC login did not produce a redirect URL — issuer may be unreachable or misconfigured",
    );
  }
  return { sessionId, redirectUrl: captured };
}

/**
 * Complete the authorization-code flow on the callback URL. Rehydrates
 * the Session that was created in `startAuthFlow`, exchanges the code
 * for tokens (the SDK does this inside `handleIncomingRedirect`), and
 * returns the resolved WebID.
 */
export async function completeAuthFlow(input: {
  sessionId: string;
  callbackUrl: string;
}): Promise<{ webId: string; sessionId: string }> {
  const storage = makeIdentityStorage(input.sessionId);
  const session = new Session({ storage }, input.sessionId);
  await session.handleIncomingRedirect(input.callbackUrl);
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("OIDC callback did not produce a logged-in session");
  }
  // Find the issuer the SDK chose so we can record it. Prefer the
  // session info, fall back to walking storage.
  const userRecord = await storage.get(
    `solidClientAuthenticationUser:${input.sessionId}`,
  );
  const oidcIssuer =
    (await storage.get("issuer")) ??
    (await storage.get("oidc:issuer")) ??
    userRecord ??
    "";
  // Connect-time persistence check (MC-176). The publish path fails for newly
  // connected WebIDs with "refresh token failed". This pins down *which* half
  // of the split it is — "no refresh token was ever stored" vs "the IdP later
  // rejected a stored token" — by asserting, right after the code exchange,
  // whether the SDK actually persisted a refresh token under the canonical
  // sessionId. Read-only: it inspects what the SDK already wrote, no behaviour
  // change to the auth flow. Pair the `oidc.connect.persisted` line with the
  // later `oidc.refresh.failed` line to read the root cause off the logs.
  let hasRefreshToken = false;
  if (userRecord) {
    try {
      hasRefreshToken =
        typeof (JSON.parse(userRecord) as { refreshToken?: unknown })
          .refreshToken === "string";
    } catch {
      /* non-JSON record — leave hasRefreshToken false */
    }
  }
  log.info("oidc.connect.persisted", {
    webId: scrubWebId(session.info.webId),
    sessionId: input.sessionId.slice(0, 8),
    hasUserRecord: !!userRecord,
    hasRefreshToken,
  });
  saveIdentity({
    webId: session.info.webId,
    sessionId: input.sessionId,
    oidcIssuer: parseIssuerFromStorageValue(oidcIssuer),
  });
  return { webId: session.info.webId, sessionId: input.sessionId };
}

function parseIssuerFromStorageValue(v: string): string {
  if (!v) return "";
  try {
    const parsed = JSON.parse(v) as { issuer?: string };
    if (typeof parsed.issuer === "string") return parsed.issuer;
  } catch {
    // Not JSON; assume v is the raw issuer URL.
  }
  return v;
}

/**
 * Load an authenticated `fetch` for a previously authorized WebID.
 *   - Returns `null` if the WebID has never been connected (caller may
 *     fall back to seeded credentials in dev).
 *   - Throws `OidcRefreshFailedError` if a stored identity exists but
 *     refresh failed — the caller MUST surface "needs reauthorization"
 *     and must NOT fall back silently (P0-R2).
 *
 * Refresh-token rotation: we pass `onNewRefreshToken` so that whenever
 * the issuer rotates the refresh token, we observe it as a structured
 * log line (and the SDK persists the new value through our IStorage
 * adapter on the same call). The SDK's `ERROR` event MUST have at
 * least one listener attached or Node aborts the worker; we wire one
 * up that records what actually went wrong so the
 * `OidcRefreshFailedError` is no longer opaque.
 */
export async function loadAuthedFetchForWebId(
  webId: string,
): Promise<typeof fetch | null> {
  const identity = getIdentityByWebId(webId);
  if (!identity) return null;

  // Reuse a still-valid authenticated session instead of refreshing again.
  // This is the core of the MC-176 fix: only spend the (single-use) refresh
  // token when the cached access token is gone or about to lapse.
  const cached = sessionCache.get(webId);
  if (
    cached &&
    cached.sessionId === identity.sessionId &&
    Date.now() < cached.expiresAt - TOKEN_EXPIRY_SKEW_MS
  ) {
    log.info("oidc.refresh.cache-hit", {
      webId: scrubWebId(webId),
      sessionId: identity.sessionId.slice(0, 8),
      expiresInMs: cached.expiresAt - Date.now(),
    });
    return cached.fetch;
  }
  // Stale or session changed (re-/connect) — drop it and re-derive below.
  if (cached) sessionCache.delete(webId);

  const storage = makeIdentityStorage(identity.sessionId);

  // `rotations` records every `newRefreshToken` event the SDK emits.
  // The SDK's persistence path is to immediately call setForUser on
  // our storage adapter — but we capture the event independently so
  // a structured log line exists even if the storage write was
  // somehow skipped or clobbered. On refresh failure the count is
  // logged so we can tell "refresh ran and rotated tokens N times
  // before giving up" from "refresh refused immediately".
  const rotations: string[] = [];
  // A dead dynamic-client registration (e.g. the issuer's `.css-data` was
  // wiped in dev) makes the SDK *throw* during refresh — `invalid_client`,
  // a network error, etc. — rather than return a non-logged-in session. We
  // must funnel that throw into the same `OidcRefreshFailedError` as the
  // returns-not-logged-in case; otherwise the raw error escapes past
  // `getOwnerFetch`'s `OidcRefreshFailedError` catch and every caller turns a
  // stale identity into an opaque 500 instead of a clear "re-connect via
  // /connect" 503. (MC-173.)
  let session: Awaited<ReturnType<typeof getSessionFromStorage>> | undefined;
  try {
    session = await getSessionFromStorage(identity.sessionId, {
      storage,
      refreshSession: true,
      onNewRefreshToken: (newToken: string) => {
        // First+last 4 chars only — proves a new value was observed
        // without exposing the secret in logs.
        const fp = `${newToken.slice(0, 4)}…${newToken.slice(-4)}`;
        rotations.push(fp);
        log.info("oidc.refresh.rotated", {
          webId: scrubWebId(webId),
          sessionId: identity.sessionId.slice(0, 8),
          tokenLen: newToken.length,
          tokenFingerprint: fp,
        });
      },
    });
  } catch (e) {
    log.warn("oidc.refresh.failed", {
      webId: scrubWebId(webId),
      sessionId: identity.sessionId.slice(0, 8),
      threw: true,
      error: (e as Error).message ?? String(e),
      rotationsDuringCall: rotations.length,
    });
    throw new OidcRefreshFailedError(webId);
  }

  if (!session || !session.info.isLoggedIn) {
    log.warn("oidc.refresh.failed", {
      webId: scrubWebId(webId),
      sessionId: identity.sessionId.slice(0, 8),
      hasSession: !!session,
      isLoggedIn: session?.info.isLoggedIn ?? false,
      rotationsDuringCall: rotations.length,
    });
    throw new OidcRefreshFailedError(webId);
  }
  const authedFetch = session.fetch.bind(session) as typeof fetch;

  // Cache the live session's fetch until just before the access token expires.
  // `expirationDate` is ms-epoch when present; if the SDK didn't surface it (or
  // it's not a sane future timestamp) we cache for one skew window only — still
  // enough to collapse a burst of publishes into a single refresh without
  // riding an unknown-lifetime token for long.
  const exp = (session.info as { expirationDate?: number }).expirationDate;
  const expiresAt =
    typeof exp === "number" && exp > Date.now()
      ? exp
      : // No expiry surfaced — cache for one skew window so a burst of publishes
        // still collapses to a single refresh, without riding an unknown-lifetime
        // token for long. (CSS access tokens live for minutes, so 60s is safe.)
        Date.now() + 2 * TOKEN_EXPIRY_SKEW_MS;
  sessionCache.set(webId, {
    sessionId: identity.sessionId,
    fetch: authedFetch,
    expiresAt,
  });

  log.info("oidc.refresh.ok", {
    webId: scrubWebId(webId),
    sessionId: identity.sessionId.slice(0, 8),
    rotationsDuringCall: rotations.length,
    cachedUntil: expiresAt,
  });
  return authedFetch;
}
