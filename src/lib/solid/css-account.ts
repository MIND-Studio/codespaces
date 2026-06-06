import "server-only";

/**
 * Talks to a Community Solid Server v7 "account API"
 * (`/.account/`) end-to-end so the bridge can finish a Solid-OIDC dance
 * server-side using only an email + password.
 *
 * We deliberately keep this small and surgical — we do NOT want a
 * general CSS client here. Two flows only:
 *   - `runPasswordLoginOidcFlow` walks login → pick-webid → consent →
 *     callback URL, returning the bridge's own `/api/auth/callback?...`
 *     URL with the OAuth `code` filled in. The caller then hands that
 *     URL to `completeAuthFlow` (`oidc-server.ts`) so the existing
 *     identity-storage path is reused.
 *
 * This module knows nothing about NextRequest / cookies on the bridge
 * side; it is pure outbound HTTP. Tests can stub it without React.
 */

type CookieJar = Map<string, string>;

class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly cssCode?: string,
  ) {
    super(message);
    this.name = "CssApiError";
  }
}

function mergeSetCookies(jar: CookieJar, setCookies: string[]): void {
  for (const line of setCookies) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const name = line.slice(0, eq).trim();
    const rest = line.slice(eq + 1);
    const semi = rest.indexOf(";");
    const value = (semi < 0 ? rest : rest.slice(0, semi)).trim();
    // Expired cookies: drop.
    if (value === "" && /expires=Thu, 01 Jan 1970/i.test(line)) {
      jar.delete(name);
      continue;
    }
    jar.set(name, value);
  }
}

function cookieHeader(jar: CookieJar): string {
  return Array.from(jar.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

async function reqJson(
  url: string,
  jar: CookieJar,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<{
  status: number;
  body: Record<string, unknown> | null;
  location: string | null;
}> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (jar.size > 0) headers["Cookie"] = cookieHeader(jar);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    redirect: "manual",
  });
  // The Fetch API exposes Set-Cookie via getSetCookie() in Node 20+.
  const setCookies =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie === "function"
      ? (
          res.headers as unknown as { getSetCookie: () => string[] }
        ).getSetCookie()
      : [];
  mergeSetCookies(jar, setCookies);
  const location = res.headers.get("location");
  let body: Record<string, unknown> | null = null;
  // 30x responses sometimes have no body; ignore parse errors.
  try {
    const text = await res.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }
  return { status: res.status, body, location };
}

async function reqRaw(
  url: string,
  jar: CookieJar,
): Promise<{ status: number; location: string | null }> {
  const headers: Record<string, string> = {};
  if (jar.size > 0) headers["Cookie"] = cookieHeader(jar);
  const res = await fetch(url, {
    method: "GET",
    headers,
    redirect: "manual",
  });
  const setCookies =
    typeof (res.headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie === "function"
      ? (
          res.headers as unknown as { getSetCookie: () => string[] }
        ).getSetCookie()
      : [];
  mergeSetCookies(jar, setCookies);
  return {
    status: res.status,
    location: res.headers.get("location"),
  };
}

/**
 * Take an OIDC redirect URL (e.g. the one returned by `startAuthFlow`)
 * plus the user's email + password, and finish the dance against a
 * Community Solid Server using its account API. Returns the bridge's
 * own `/api/auth/callback?code=...&state=...` URL on success; the
 * caller hands it to `completeAuthFlow` to materialise tokens.
 *
 * Why we don't just embed CSS's login form in an iframe: cross-origin,
 * blocked by frame-ancestors. Why we don't just script `/oidc/auth`
 * directly: CSS v7 splits the OIDC dance into discrete prompts driven
 * by the account API (`pick-webid` + `consent`) and refuses to short-
 * circuit them. We walk the exact same prompts a browser would.
 */
export async function runPasswordLoginOidcFlow(input: {
  oidcRedirectUrl: string;
  email: string;
  password: string;
}): Promise<{ callbackUrl: string }> {
  const jar: CookieJar = new Map();

  // Step 1: read account controls to discover the password login URL.
  const issuer = new URL(input.oidcRedirectUrl).origin;
  const accountIndex = await reqJson(`${issuer}/.account/`, jar);
  if (accountIndex.status !== 200 || !accountIndex.body) {
    throw new HttpError(
      "could not read CSS account controls",
      accountIndex.status,
    );
  }
  const passwordLogin = pickStringPath(accountIndex.body, [
    "controls",
    "password",
    "login",
  ]);
  if (!passwordLogin) {
    throw new HttpError("CSS account did not advertise password login", 500);
  }

  // Step 2: log in.
  const login = await reqJson(passwordLogin, jar, {
    method: "POST",
    body: { email: input.email, password: input.password },
  });
  if (login.status >= 400) {
    throw new HttpError(
      stringField(login.body, "message") ?? "invalid email or password",
      login.status,
      stringField(login.body, "errorCode") ?? undefined,
    );
  }

  // Step 3: kick off the OIDC interaction.
  const oidc = await reqRaw(input.oidcRedirectUrl, jar);
  // Expect a 303 to /.account/ — that's CSS asking the client to drive
  // the pick-webid / consent prompts via the account API.
  if (oidc.status !== 303 || !oidc.location) {
    throw new HttpError(
      `unexpected OIDC start response (HTTP ${oidc.status})`,
      oidc.status,
    );
  }

  // Step 4: refresh account view — now the `oidc.*` controls exist.
  const accountMid = await reqJson(`${issuer}/.account/`, jar);
  const pickWebIdUrl = pickStringPath(accountMid.body ?? {}, [
    "controls",
    "oidc",
    "webId",
  ]);
  const consentUrl = pickStringPath(accountMid.body ?? {}, [
    "controls",
    "oidc",
    "consent",
  ]);
  if (!pickWebIdUrl || !consentUrl) {
    throw new HttpError(
      "CSS account did not advertise OIDC controls — is an interaction active?",
      500,
    );
  }

  // Find a WebID linked to this account.
  const accountWebIdsUrl = pickStringPath(accountMid.body ?? {}, [
    "controls",
    "account",
    "webId",
  ]);
  if (!accountWebIdsUrl) {
    throw new HttpError("CSS did not expose account.webId control", 500);
  }
  const webIds = await reqJson(accountWebIdsUrl, jar);
  const links = webIds.body?.["webIdLinks"] as
    | Record<string, string>
    | undefined;
  const candidate = links ? Object.keys(links) : [];
  if (candidate.length === 0) {
    throw new HttpError(
      "no WebID linked to this account — register a pod first",
      400,
    );
  }
  // For the single-WebID-per-account case (the common path on CSS)
  // we just pick it. Multi-WebID accounts could surface a UI later.
  const webId = candidate[0];

  // Step 5: pick the WebID for this interaction.
  const pick = await reqJson(pickWebIdUrl, jar, {
    method: "POST",
    body: { webId },
  });
  if (pick.status >= 400) {
    throw new HttpError(
      stringField(pick.body, "message") ?? "pick-webid failed",
      pick.status,
    );
  }
  const resumeAfterPick =
    stringField(pick.body, "location") ?? `${issuer}/.account/`;

  // Step 6: resume the OIDC flow once — moves prompt from "login" to
  // "consent". We follow the redirect manually so we capture cookies.
  const resumed = await reqRaw(resumeAfterPick, jar);
  if (resumed.status < 200 || resumed.status >= 400) {
    // 303 expected; non-3xx here means we couldn't progress.
    if (resumed.status === 200 || resumed.status === 303) {
      // ok — fall through.
    } else {
      throw new HttpError(
        `OIDC resume after pick-webid failed (HTTP ${resumed.status})`,
        resumed.status,
      );
    }
  }

  // Step 7: post consent.
  //
  // `remember: true` is load-bearing, not a UX nicety. CSS v7 only grants the
  // `offline_access` scope — and therefore only issues a **refresh token** —
  // when the consent is "remembered". With an empty body CSS returns an access
  // token but no refresh token, even though the auth request asked for
  // `offline_access` and `prompt=consent`. The bridge then succeeds at connect
  // (isLoggedIn:true) but the very first forced refresh on the publish path has
  // nothing to spend → `isLoggedIn:false` → "WebID … needs to reauthorize via
  // /connect (refresh token failed)", permanently. Verified against
  // pod.mindpods.org: `{}` → no refresh token; `{ remember: true }` → a 43-char
  // refresh token is stored and subsequent publishes refresh cleanly. (MC-176.)
  const consent = await reqJson(consentUrl, jar, {
    method: "POST",
    body: { remember: true },
  });
  if (consent.status >= 400) {
    throw new HttpError(
      stringField(consent.body, "message") ?? "OIDC consent failed",
      consent.status,
    );
  }
  const resumeAfterConsent = stringField(consent.body, "location");
  if (!resumeAfterConsent) {
    throw new HttpError(
      "OIDC consent did not return a resume URL",
      500,
    );
  }

  // Step 8: follow the final resume — CSS now 303s to the bridge's
  // callback with `code` + `state` filled in. That URL is what
  // `completeAuthFlow` expects.
  const final = await reqRaw(resumeAfterConsent, jar);
  if (final.status !== 303 || !final.location) {
    throw new HttpError(
      `OIDC final resume did not redirect (HTTP ${final.status})`,
      final.status,
    );
  }
  return { callbackUrl: final.location };
}

function pickStringPath(
  obj: unknown,
  path: string[],
): string | undefined {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "string" ? cur : undefined;
}

function stringField(
  obj: Record<string, unknown> | null,
  key: string,
): string | undefined {
  if (!obj) return undefined;
  const v = obj[key];
  return typeof v === "string" ? v : undefined;
}

export { HttpError as CssApiError };
