import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { clip, log } from "@/lib/log";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { startAuthFlow } from "@/lib/solid/oidc-server";
import { fetchProfile } from "@/lib/solid/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "mc-oidc-session";
const COOKIE_TTL_SECONDS = 10 * 60; // 10 minutes — only needs to last through the auth dance

export async function POST(req: Request) {
  const limited = await rateLimit("authStart", RATE_LIMITS.authStart);
  if (limited) return limited;
  const env = getEnv();

  // CSRF defense: this route is state-changing (it plants an OIDC
  // session keyed to whatever issuer the body claims). A form post
  // from another origin must not be able to trigger it. We accept the
  // request only when at least one of these holds:
  //   - the Origin header matches BRIDGE_PUBLIC_URL (allows same-origin
  //     fetches from our own dashboard)
  //   - the Sec-Fetch-Site header says "same-origin" (modern browsers).
  // Both are unforgeable from a cross-site form post.
  const hdrs = await headers();
  const origin = hdrs.get("origin") ?? "";
  const secFetchSite = hdrs.get("sec-fetch-site") ?? "";
  const ownOrigin = stripTrailingSlash(env.bridgePublicUrl);
  if (origin !== ownOrigin && secFetchSite !== "same-origin" && secFetchSite !== "same-site") {
    return NextResponse.json(
      { error: "cross-origin auth start is not allowed", code: "CSRF" },
      { status: 403 },
    );
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    /* form-submission paths may not be JSON; we accept empty */
  }
  let oidcIssuer = (body as Record<string, unknown>)?.oidcIssuer;
  let webIdHint: string | undefined;
  if (typeof oidcIssuer !== "string") {
    // Fall back to form-urlencoded parsing.
    try {
      const text = await req.clone().text();
      const params = new URLSearchParams(text);
      oidcIssuer = params.get("oidcIssuer") ?? undefined;
      const wid = params.get("webId");
      if (wid) webIdHint = wid;
    } catch {
      /* ignore */
    }
  } else if (typeof (body as Record<string, unknown>)?.webId === "string") {
    webIdHint = (body as Record<string, unknown>).webId as string;
  }
  if (typeof oidcIssuer !== "string" || !/^https?:\/\//.test(oidcIssuer)) {
    return NextResponse.json({ error: "oidcIssuer (URL) is required" }, { status: 400 });
  }
  const normalised = oidcIssuer.endsWith("/") ? oidcIssuer : `${oidcIssuer}/`;

  // Issuer pinning. When the caller passes a WebID hint we cross-check
  // that the WebID's profile actually advertises this issuer as its
  // `solid:oidcIssuer`. Without this, an attacker can complete a flow at
  // their OWN issuer and bind their WebID under whatever identity they
  // claim. The check is only done when a WebID hint is supplied; legacy
  // callers that only know the issuer URL skip this gate (and the rest
  // of the chain reaches `/repos.POST`'s pod-root check, which already
  // refuses to register a podRoot the WebID doesn't claim).
  if (webIdHint) {
    try {
      const profile = await fetchProfile(webIdHint);
      const advertised = profile.oidcIssuer;
      if (!advertised) {
        return NextResponse.json(
          { error: "webId profile does not advertise solid:oidcIssuer" },
          { status: 400 },
        );
      }
      const advertisedN = advertised.endsWith("/") ? advertised : `${advertised}/`;
      if (advertisedN !== normalised) {
        return NextResponse.json(
          {
            error: "oidcIssuer does not match the WebID's advertised solid:oidcIssuer",
            code: "ISSUER_MISMATCH",
          },
          { status: 400 },
        );
      }
    } catch (e) {
      return NextResponse.json(
        {
          error: "failed to verify WebID profile for issuer pinning",
          detail: (e as Error).message,
        },
        { status: 400 },
      );
    }
  }

  try {
    const { sessionId, redirectUrl } = await startAuthFlow({
      oidcIssuer: normalised,
    });
    const jar = await cookies();
    jar.set(COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_TTL_SECONDS,
      secure: env.isProd,
    });
    return NextResponse.json({ redirectUrl });
  } catch (e) {
    log.error("auth.start.failed", {
      detail: clip((e as Error).message ?? String(e), 200),
    });
    return NextResponse.json(
      { error: "failed to start OIDC flow", code: "OIDC_START_FAILED" },
      { status: 500 },
    );
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
