import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { startAuthFlow, completeAuthFlow } from "@/lib/solid/oidc-server";
import { runPasswordLoginOidcFlow, CssApiError } from "@/lib/solid/css-account";
import { issueSession } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { log, clip, scrubWebId } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bridge-driven password login against a Community Solid Server.
 *
 * Modern web UX wants users to type email + password against the app
 * and be signed in. Solid-OIDC's normal "delegate via popup" flow is
 * the right model for THIRD-PARTY pods (the bridge can't safely take
 * a remote pod's password), but for the FIRST-PARTY pod that the same
 * operator runs alongside the bridge, that hop is needless friction.
 *
 * This route accepts {email, password} and (optionally) {oidcIssuer}.
 * It starts the standard OIDC dance, then drives it server-side
 * through CSS's account API (login → pick-webid → consent → callback)
 * using a cookie jar. The end state is identical to a popup flow —
 * the existing identity storage holds the refresh token and the
 * bridge issues its own session cookie — so downstream code stays
 * unchanged.
 *
 * Defaults `oidcIssuer` to POD_BASE_URL (the bundled CSS). External
 * Solid pods must continue to use the popup flow at /api/auth/start.
 */
export async function POST(req: Request) {
  const env = getEnv();
  const limited = await rateLimit("authStart", RATE_LIMITS.authStart);
  if (limited) return limited;

  // CSRF defense (same shape as /api/auth/start): require either the
  // Origin to match BRIDGE_PUBLIC_URL, or Sec-Fetch-Site to mark this
  // as a same-origin / same-site request.
  const hdrs = await headers();
  const origin = hdrs.get("origin") ?? "";
  const secFetchSite = hdrs.get("sec-fetch-site") ?? "";
  const ownOrigin = env.bridgePublicUrl.replace(/\/$/, "");
  if (
    origin !== ownOrigin &&
    secFetchSite !== "same-origin" &&
    secFetchSite !== "same-site"
  ) {
    return NextResponse.json(
      { error: "cross-origin login is not allowed", code: "CSRF" },
      { status: 403 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !email.includes("@") || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 },
    );
  }
  const issuerRaw = typeof body.oidcIssuer === "string" ? body.oidcIssuer : env.podBaseUrl;
  const oidcIssuer = issuerRaw.endsWith("/") ? issuerRaw : `${issuerRaw}/`;
  if (!/^https?:\/\//.test(oidcIssuer)) {
    return NextResponse.json(
      { error: "oidcIssuer must be an http(s) URL" },
      { status: 400 },
    );
  }

  // Start the OIDC dance — produces a redirect URL + a session in
  // identity storage we can resume from at callback time.
  let sessionId: string;
  let redirectUrl: string;
  try {
    const started = await startAuthFlow({ oidcIssuer });
    sessionId = started.sessionId;
    redirectUrl = started.redirectUrl;
  } catch (e) {
    log.error("auth.login.start_failed", {
      detail: clip((e as Error).message ?? String(e), 200),
    });
    return NextResponse.json(
      { error: "could not reach the pod server", code: "OIDC_START_FAILED" },
      { status: 502 },
    );
  }

  // Walk the CSS account API + OIDC interaction server-side.
  let callbackUrl: string;
  try {
    const flow = await runPasswordLoginOidcFlow({
      oidcRedirectUrl: redirectUrl,
      email,
      password,
    });
    callbackUrl = flow.callbackUrl;
  } catch (e) {
    if (e instanceof CssApiError && e.status >= 400 && e.status < 500) {
      log.warn("auth.login.rejected", {
        status: e.status,
        cssCode: e.cssCode ?? "",
      });
      // Don't leak the specific CSS message — collapse all 4xx into a
      // single "bad credentials" response so this route can't be used
      // to enumerate which CSS accounts exist.
      return NextResponse.json(
        { error: "email or password is incorrect", code: "BAD_CREDENTIALS" },
        { status: 401 },
      );
    }
    log.error("auth.login.css_failed", {
      detail: clip((e as Error).message ?? String(e), 200),
    });
    return NextResponse.json(
      { error: "could not complete login", code: "OIDC_LOGIN_FAILED" },
      { status: 502 },
    );
  }

  // Rebuild the callback URL onto the bridge's PUBLIC origin so the
  // SDK's redirect-URL comparison passes (same trick as
  // /api/auth/callback handler).
  const search = new URL(callbackUrl).search;
  const completeUrl = `${env.bridgePublicUrl}/api/auth/callback${search}`;
  let webId: string;
  try {
    const done = await completeAuthFlow({ sessionId, callbackUrl: completeUrl });
    webId = done.webId;
  } catch (e) {
    log.error("auth.login.complete_failed", {
      detail: clip((e as Error).message ?? String(e), 200),
    });
    return NextResponse.json(
      { error: "OIDC token exchange failed", code: "OIDC_COMPLETE_FAILED" },
      { status: 502 },
    );
  }

  await issueSession(webId);
  log.info("auth.login.success", { webId: scrubWebId(webId) });
  return NextResponse.json({ ok: true, webId });
}
