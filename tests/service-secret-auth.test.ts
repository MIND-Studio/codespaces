import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory header/cookie stores driven per test.
const hdrStore = new Map<string, string>();
const cookieStore = new Map<string, { value: string }>();

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (k: string) => hdrStore.get(k.toLowerCase()) ?? null,
  }),
  cookies: async () => ({
    get: (k: string) => cookieStore.get(k),
  }),
}));

// Drive getEnv() per test so we can flip serviceSecret / isProd.
let envObj: Record<string, unknown>;
vi.mock("@/lib/env", () => ({ getEnv: () => envObj }));

import { requireSession } from "@/lib/auth/session";

const WEBID = "https://pods.example/alice/profile/card#me";

beforeEach(() => {
  hdrStore.clear();
  cookieStore.clear();
  envObj = { isProd: true, serviceSecret: null, sessionSecret: Buffer.alloc(32) };
});

describe("requireSession — trusted-service-secret path", () => {
  it("accepts a correct secret + on-behalf-of, in prod, CSRF waived", async () => {
    envObj.serviceSecret = "s3cr3t";
    hdrStore.set("x-mind-service-secret", "s3cr3t");
    hdrStore.set("x-mind-on-behalf-of", WEBID);

    const r = await requireSession();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.webId).toBe(WEBID);
  });

  it("rejects a wrong secret (falls through to 401 no-session)", async () => {
    envObj.serviceSecret = "s3cr3t";
    hdrStore.set("x-mind-service-secret", "wrong");
    hdrStore.set("x-mind-on-behalf-of", WEBID);

    const r = await requireSession();
    expect(r.ok).toBe(false);
  });

  it("ignores service headers entirely when no secret is configured", async () => {
    envObj.serviceSecret = null;
    hdrStore.set("x-mind-service-secret", "anything");
    hdrStore.set("x-mind-on-behalf-of", WEBID);

    const r = await requireSession();
    expect(r.ok).toBe(false);
  });

  it("requires the on-behalf-of header even with a valid secret", async () => {
    envObj.serviceSecret = "s3cr3t";
    hdrStore.set("x-mind-service-secret", "s3cr3t");
    // no x-mind-on-behalf-of

    const r = await requireSession();
    expect(r.ok).toBe(false);
  });
});
