import "server-only";
import { getEnv } from "@/lib/env";
import { getCssAuthedFetch } from "@/lib/solid/auth";
import { loadAuthedFetchForWebId, OidcRefreshFailedError } from "@/lib/solid/oidc-server";

export type OwnerFetch = {
  fetch: typeof fetch;
  mode: "delegated" | "seeded";
  logout: () => Promise<void>;
};

/**
 * Thrown when a delegated OIDC token has expired and the seeded fallback
 * is disabled (production, or dev with ALLOW_SEEDED_FALLBACK unset). The
 * caller is expected to surface "needs reauthorization" to the user.
 */
export class OwnerFetchUnavailableError extends Error {
  constructor(
    public readonly reason: "needs-reauthorization" | "no-identity-and-seeded-disabled",
    public readonly webId: string,
  ) {
    super(
      reason === "needs-reauthorization"
        ? `WebID ${webId} needs to reauthorize via /connect (refresh token failed)`
        : `WebID ${webId} has no delegated identity and the seeded fallback is disabled`,
    );
    this.name = "OwnerFetchUnavailableError";
  }
}

/**
 * Resolve an authenticated `fetch` for a repo's owner.
 *
 * Order of resolution:
 *   1. Delegated Solid-OIDC token from `/connect` if present.
 *   2. Seeded CSS credentials — DEV ONLY. The seeded path is locked
 *      behind `NODE_ENV !== "production"` AND `ALLOW_SEEDED_FALLBACK=1`
 *      via the env module (P0-S2). Production deployments either use the
 *      delegated path or fail loudly.
 *
 * "Delegated identity expired" and "never connected" are kept distinct
 * (P0-R2) — the former never falls back, even in dev, because the user
 * has demonstrably authorized the bridge and the right answer is to
 * prompt for re-authorization, not to write under the operator account.
 */
export async function getOwnerFetch(webId: string): Promise<OwnerFetch> {
  let delegated: typeof fetch | null = null;
  try {
    delegated = await loadAuthedFetchForWebId(webId);
  } catch (e) {
    if (e instanceof OidcRefreshFailedError) {
      throw new OwnerFetchUnavailableError("needs-reauthorization", webId);
    }
    throw e;
  }
  if (delegated) {
    return {
      fetch: delegated,
      mode: "delegated",
      logout: async () => {
        // Refresh tokens stay in storage so future requests work; nothing to clean up here.
      },
    };
  }

  const env = getEnv();
  if (env.isProd || !env.allowSeededFallback) {
    throw new OwnerFetchUnavailableError("no-identity-and-seeded-disabled", webId);
  }

  const seeded = await getCssAuthedFetch({
    cssBaseUrl: env.podBaseUrl,
    email: env.podUserEmail,
    password: env.podUserPassword,
    webId,
  });
  return {
    fetch: seeded.fetch,
    mode: "seeded",
    logout: seeded.logout,
  };
}
