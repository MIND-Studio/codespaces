import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MC-173 regression: a stale delegated identity (the issuer's dynamic-client
 * registration is gone — e.g. `.css-data/` was wiped) must surface as a
 * structured `OidcRefreshFailedError`, whether the SDK *returns* a
 * non-logged-in session OR *throws* during refresh (`invalid_client`,
 * network). Before the fix, a thrown refresh escaped `loadAuthedFetchForWebId`
 * raw and every caller turned it into an opaque 500 instead of the
 * "re-connect via /connect" path.
 */

const { getSessionFromStorage } = vi.hoisted(() => ({
  getSessionFromStorage: vi.fn(),
}));

vi.mock("@inrupt/solid-client-authn-node", () => ({
  // `Session` is imported by the module but unused on the load path.
  Session: class {},
  getSessionFromStorage,
}));

const { getIdentityByWebId } = vi.hoisted(() => ({
  getIdentityByWebId: vi.fn(),
}));

vi.mock("@/lib/registry/identities", () => ({
  getIdentityByWebId,
  makeIdentityStorage: () => ({}),
  saveIdentity: vi.fn(),
}));

const WEBID = "http://localhost:3011/alice/profile/card#me";
const IDENTITY = { webId: WEBID, sessionId: "sess-1234-5678", oidcIssuer: "" };

beforeEach(() => {
  getSessionFromStorage.mockReset();
  getIdentityByWebId.mockReset();
});

describe("loadAuthedFetchForWebId — dead registration normalization", () => {
  it("returns null when the WebID was never connected (no identity row)", async () => {
    const { loadAuthedFetchForWebId } = await import("@/lib/solid/oidc-server");
    getIdentityByWebId.mockReturnValue(null);
    expect(await loadAuthedFetchForWebId(WEBID)).toBeNull();
    expect(getSessionFromStorage).not.toHaveBeenCalled();
  });

  it("throws OidcRefreshFailedError when refresh THROWS (dead client registration)", async () => {
    const { loadAuthedFetchForWebId, OidcRefreshFailedError } = await import(
      "@/lib/solid/oidc-server"
    );
    getIdentityByWebId.mockReturnValue(IDENTITY);
    // The SDK throws `invalid_client` when the dynamic registration is gone.
    getSessionFromStorage.mockRejectedValue(new Error("invalid_client"));
    await expect(loadAuthedFetchForWebId(WEBID)).rejects.toBeInstanceOf(OidcRefreshFailedError);
  });

  it("throws OidcRefreshFailedError when refresh RETURNS a non-logged-in session", async () => {
    const { loadAuthedFetchForWebId, OidcRefreshFailedError } = await import(
      "@/lib/solid/oidc-server"
    );
    getIdentityByWebId.mockReturnValue(IDENTITY);
    getSessionFromStorage.mockResolvedValue({ info: { isLoggedIn: false } });
    await expect(loadAuthedFetchForWebId(WEBID)).rejects.toBeInstanceOf(OidcRefreshFailedError);
  });

  it("returns the session fetch on a healthy refresh", async () => {
    const { loadAuthedFetchForWebId } = await import("@/lib/solid/oidc-server");
    getIdentityByWebId.mockReturnValue(IDENTITY);
    const fetchFn = vi.fn();
    getSessionFromStorage.mockResolvedValue({
      info: { isLoggedIn: true },
      fetch: fetchFn,
    });
    const out = await loadAuthedFetchForWebId(WEBID);
    expect(typeof out).toBe("function");
  });
});
