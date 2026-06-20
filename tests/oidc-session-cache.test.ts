import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MC-176: Pages publish failed for newly-connected WebIDs with "refresh token
 * failed" *after one successful publish*. Root cause was that
 * `loadAuthedFetchForWebId` forced a token refresh on EVERY publish
 * (`refreshSession: true`); against a pod issuing single-use refresh tokens the
 * second publish reused a consumed token → `isLoggedIn:false` forever.
 *
 * The fix is an in-process session cache: while the access token is still valid
 * we hand back the same authenticated `fetch` instead of refreshing again. These
 * tests pin the cache's behaviour at the module interface (the SDK + identity
 * store are mocked), independent of a live pod.
 */

const { getSessionFromStorage } = vi.hoisted(() => ({
  getSessionFromStorage: vi.fn(),
}));
vi.mock("@inrupt/solid-client-authn-node", () => ({
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

beforeEach(() => {
  getSessionFromStorage.mockReset();
  getIdentityByWebId.mockReset();
});

function sessionLoggedIn(label: string, expirationDate?: number) {
  const fetchFn = vi.fn();
  (fetchFn as unknown as { _label: string })._label = label;
  return { info: { isLoggedIn: true, expirationDate }, fetch: fetchFn };
}

describe("loadAuthedFetchForWebId — in-process session cache (MC-176)", () => {
  it("reuses the cached fetch instead of refreshing again while the token is valid", async () => {
    const { loadAuthedFetchForWebId, clearCachedSession } = await import("@/lib/solid/oidc-server");
    clearCachedSession(WEBID);
    getIdentityByWebId.mockReturnValue({
      webId: WEBID,
      sessionId: "sess-aaaa",
      oidcIssuer: "",
    });
    // Access token valid for 5 more minutes.
    getSessionFromStorage.mockResolvedValue(sessionLoggedIn("first", Date.now() + 5 * 60_000));

    const first = await loadAuthedFetchForWebId(WEBID);
    const second = await loadAuthedFetchForWebId(WEBID);

    // The second publish must NOT spend another refresh token.
    expect(getSessionFromStorage).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("re-derives when the WebID re-connects (sessionId changes)", async () => {
    const { loadAuthedFetchForWebId, clearCachedSession } = await import("@/lib/solid/oidc-server");
    clearCachedSession(WEBID);
    getIdentityByWebId.mockReturnValue({
      webId: WEBID,
      sessionId: "sess-old",
      oidcIssuer: "",
    });
    getSessionFromStorage.mockResolvedValue(sessionLoggedIn("old", Date.now() + 5 * 60_000));
    await loadAuthedFetchForWebId(WEBID);

    // User re-/connect → new sessionId. The cached entry must be discarded.
    getIdentityByWebId.mockReturnValue({
      webId: WEBID,
      sessionId: "sess-new",
      oidcIssuer: "",
    });
    getSessionFromStorage.mockResolvedValue(sessionLoggedIn("new", Date.now() + 5 * 60_000));
    await loadAuthedFetchForWebId(WEBID);

    expect(getSessionFromStorage).toHaveBeenCalledTimes(2);
  });

  it("re-derives once the cached access token is within the expiry skew", async () => {
    const { loadAuthedFetchForWebId, clearCachedSession } = await import("@/lib/solid/oidc-server");
    clearCachedSession(WEBID);
    getIdentityByWebId.mockReturnValue({
      webId: WEBID,
      sessionId: "sess-exp",
      oidcIssuer: "",
    });
    // Token already inside the 60s skew window → must not be reused.
    getSessionFromStorage.mockResolvedValue(sessionLoggedIn("stale", Date.now() + 10_000));
    await loadAuthedFetchForWebId(WEBID);
    await loadAuthedFetchForWebId(WEBID);

    expect(getSessionFromStorage).toHaveBeenCalledTimes(2);
  });

  it("clearCachedSession forces the next call to refresh", async () => {
    const { loadAuthedFetchForWebId, clearCachedSession } = await import("@/lib/solid/oidc-server");
    clearCachedSession(WEBID);
    getIdentityByWebId.mockReturnValue({
      webId: WEBID,
      sessionId: "sess-clear",
      oidcIssuer: "",
    });
    getSessionFromStorage.mockResolvedValue(sessionLoggedIn("c", Date.now() + 5 * 60_000));
    await loadAuthedFetchForWebId(WEBID);
    clearCachedSession(WEBID);
    await loadAuthedFetchForWebId(WEBID);

    expect(getSessionFromStorage).toHaveBeenCalledTimes(2);
  });
});
