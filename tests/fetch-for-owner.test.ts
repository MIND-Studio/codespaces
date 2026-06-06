import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * MC-173 contract: `getOwnerFetch` must convert a dead delegated identity
 * (`OidcRefreshFailedError` from the loader) into a clear
 * `OwnerFetchUnavailableError("needs-reauthorization")` — and must NOT
 * silently fall back to seeded creds, even with the dev fallback enabled
 * (P0-R2). Routes render that as a 503 pointing at /connect, instead of a
 * silent write failure.
 */

// A mock oidc-server module: the loader is controllable per-test, and we
// re-export a real `OidcRefreshFailedError` class so `instanceof` holds.
class MockOidcRefreshFailedError extends Error {
  constructor(public readonly webId: string) {
    super(`OIDC refresh failed for WebID ${webId}`);
    this.name = "OidcRefreshFailedError";
  }
}
const { loadAuthedFetchForWebId } = vi.hoisted(() => ({
  loadAuthedFetchForWebId: vi.fn(),
}));
vi.mock("@/lib/solid/oidc-server", () => ({
  loadAuthedFetchForWebId,
  OidcRefreshFailedError: MockOidcRefreshFailedError,
}));

const seededLogout = vi.fn();
const { getCssAuthedFetch } = vi.hoisted(() => ({
  getCssAuthedFetch: vi.fn(),
}));
vi.mock("@/lib/solid/auth", () => ({ getCssAuthedFetch }));

const { getEnv } = vi.hoisted(() => ({ getEnv: vi.fn() }));
vi.mock("@/lib/env", () => ({ getEnv }));

const WEBID = "http://localhost:3011/alice/profile/card#me";

function devEnv(overrides: Record<string, unknown> = {}) {
  return {
    isProd: false,
    allowSeededFallback: true,
    podBaseUrl: "http://localhost:3011/",
    podUserEmail: "alice@mind-codespaces.local",
    podUserPassword: "x",
    ...overrides,
  };
}

beforeEach(() => {
  loadAuthedFetchForWebId.mockReset();
  getCssAuthedFetch.mockReset();
  getEnv.mockReset();
  seededLogout.mockReset();
  getCssAuthedFetch.mockResolvedValue({ fetch: vi.fn(), logout: seededLogout });
});

describe("getOwnerFetch — stale delegated identity", () => {
  it("maps a failed refresh to needs-reauthorization and does NOT fall back to seeded (dev)", async () => {
    const { getOwnerFetch, OwnerFetchUnavailableError } = await import(
      "@/lib/solid/fetch-for-owner"
    );
    getEnv.mockReturnValue(devEnv()); // seeded fallback IS enabled
    loadAuthedFetchForWebId.mockRejectedValue(
      new MockOidcRefreshFailedError(WEBID),
    );

    await expect(getOwnerFetch(WEBID)).rejects.toMatchObject({
      reason: "needs-reauthorization",
    });
    await expect(getOwnerFetch(WEBID)).rejects.toBeInstanceOf(
      OwnerFetchUnavailableError,
    );
    // The connected-but-dead identity must never use the operator account.
    expect(getCssAuthedFetch).not.toHaveBeenCalled();
  });

  it("falls back to seeded creds when the WebID was never connected (dev)", async () => {
    const { getOwnerFetch } = await import("@/lib/solid/fetch-for-owner");
    getEnv.mockReturnValue(devEnv());
    loadAuthedFetchForWebId.mockResolvedValue(null); // never connected

    const owner = await getOwnerFetch(WEBID);
    expect(owner.mode).toBe("seeded");
    expect(getCssAuthedFetch).toHaveBeenCalledOnce();
  });

  it("never-connected in prod throws instead of using seeded creds", async () => {
    const { getOwnerFetch } = await import("@/lib/solid/fetch-for-owner");
    getEnv.mockReturnValue(devEnv({ isProd: true, allowSeededFallback: false }));
    loadAuthedFetchForWebId.mockResolvedValue(null);

    await expect(getOwnerFetch(WEBID)).rejects.toMatchObject({
      reason: "no-identity-and-seeded-disabled",
    });
    expect(getCssAuthedFetch).not.toHaveBeenCalled();
  });
});
