import "server-only";
import { randomUUID } from "node:crypto";
import { Session, getSessionFromStorage } from "@inrupt/solid-client-authn-node";
import {
  getIdentityByWebId,
  makeIdentityStorage,
  saveIdentity,
} from "@/lib/registry/identities";
import { getEnv } from "@/lib/env";

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
  const oidcIssuer =
    (await storage.get("issuer")) ??
    (await storage.get("oidc:issuer")) ??
    (await storage.get(`solidClientAuthenticationUser:${input.sessionId}`)) ??
    "";
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
 */
export async function loadAuthedFetchForWebId(
  webId: string,
): Promise<typeof fetch | null> {
  const identity = getIdentityByWebId(webId);
  if (!identity) return null;
  const storage = makeIdentityStorage(identity.sessionId);
  const session = await getSessionFromStorage(identity.sessionId, {
    storage,
    refreshSession: true,
  });
  if (!session || !session.info.isLoggedIn) {
    throw new OidcRefreshFailedError(webId);
  }
  return session.fetch.bind(session) as typeof fetch;
}
