import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getEnv } from "@/lib/env";
import { createUser } from "@/lib/registry/users";
import { RegistryError, validateName } from "@/lib/registry/repos";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { log, clip } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Multi-user account onboarding (§4).
 *
 * Proxies a sign-up request to CSS's `/idp/register/` JSON API, which
 * creates an account + a pod + a WebID. On success we record the user
 * in our `users` table so the dashboard can surface a /people/{slug}
 * profile and we can enforce per-user quotas against a stable id.
 *
 * The flow does NOT complete OIDC delegation — the user still needs to
 * visit /connect once to authorize the bridge as a client. The response
 * body carries the right redirect URL so the client UI can jump there.
 *
 * Disabled when `BRIDGE_ENABLE_SIGNUP=1` is not set — keeps the route
 * dormant on deployments that don't want public signup.
 */

export async function POST(req: Request) {
  const env = getEnv();
  if (process.env.BRIDGE_ENABLE_SIGNUP !== "1") {
    // User-facing copy stays human; the operator hint (set BRIDGE_ENABLE_SIGNUP=1)
    // lives in the route doc-comment above, not in a response shown to visitors.
    return NextResponse.json(
      { error: "Account creation isn't available on this bridge." },
      { status: 403 },
    );
  }

  // CSRF: same Origin / Sec-Fetch-Site rule as /api/auth/start.
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
      { error: "cross-origin signup is not allowed", code: "CSRF" },
      { status: 403 },
    );
  }

  const limited = await rateLimit("authStart", RATE_LIMITS.authStart);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { email, password, podName } = (body ?? {}) as Record<string, unknown>;

  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    typeof podName !== "string"
  ) {
    return NextResponse.json(
      { error: "email, password, podName are required strings" },
      { status: 400 },
    );
  }
  if (!email.includes("@")) {
    return NextResponse.json(
      { error: "email must look like an email address" },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400 },
    );
  }
  try {
    validateName(podName, "owner");
  } catch (e) {
    if (e instanceof RegistryError) {
      return NextResponse.json({ error: e.message, code: e.code }, { status: 400 });
    }
    throw e;
  }

  const podBase = env.podBaseUrl.endsWith("/")
    ? env.podBaseUrl
    : env.podBaseUrl + "/";

  // CSS v7 dropped the single-POST `/idp/register/` endpoint that earlier
  // CSS shipped. The v7 path is a three-step account-API dance:
  //   1) POST /.account/account/         → creates a blank account,
  //                                        sets a css-account session cookie
  //   2) POST controls.password.create   → attaches {email, password} login
  //   3) POST controls.account.pod       → creates the pod and WebID
  // We carry the css-account cookie through manually since we're outside
  // a browser. If any step fails after step 1, the blank account is left
  // dangling on CSS — operator can clean it up; for the prototype the
  // failure-rate is low enough that we don't bother with compensating
  // deletes here.
  let cookie: string | null = null;
  let podCreateUrl: string | null = null;
  let passwordCreateUrl: string | null = null;
  try {
    // Step 1: create blank account.
    const r1 = await fetch(`${podBase}.account/account/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    });
    if (!r1.ok) {
      throw new Error(`CSS account create returned ${r1.status}`);
    }
    cookie = extractSetCookie(r1, "css-account");
    if (!cookie) throw new Error("CSS did not set a css-account cookie");

    // Step 2: read controls to find this account's password.create + pod URLs.
    const r2 = await fetch(`${podBase}.account/`, {
      headers: { Accept: "application/json", Cookie: cookie },
    });
    const ctrlBody = (await r2.json()) as Record<string, unknown>;
    passwordCreateUrl = pickStringPath(ctrlBody, ["controls", "password", "create"]);
    podCreateUrl = pickStringPath(ctrlBody, ["controls", "account", "pod"]);
    if (!passwordCreateUrl || !podCreateUrl) {
      throw new Error("CSS did not advertise password.create / account.pod");
    }
  } catch (e) {
    log.error("signup.css_unreachable", {
      detail: clip((e as Error).message ?? String(e), 200),
    });
    return NextResponse.json(
      { error: "could not reach the pod server", code: "CSS_UNREACHABLE" },
      { status: 502 },
    );
  }

  // Step 3: attach password to the new account.
  const pwResp = await fetch(passwordCreateUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: cookie },
    body: JSON.stringify({ email, password }),
  });
  if (!pwResp.ok) {
    const errBody = await safeJson(pwResp);
    log.warn("signup.css_rejected", {
      status: pwResp.status,
      detail: clip(stringField(errBody, "message") ?? "", 200),
    });
    return NextResponse.json(
      {
        error:
          stringField(errBody, "message") ??
          `pod server rejected the email/password (HTTP ${pwResp.status})`,
        code: "SIGNUP_REJECTED",
      },
      { status: 400 },
    );
  }

  // Step 4: create the pod + WebID.
  const podResp = await fetch(podCreateUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Cookie: cookie },
    body: JSON.stringify({ name: podName }),
  });
  if (!podResp.ok) {
    const errBody = await safeJson(podResp);
    log.warn("signup.css_pod_rejected", {
      status: podResp.status,
      detail: clip(stringField(errBody, "message") ?? "", 200),
    });
    return NextResponse.json(
      {
        error:
          stringField(errBody, "message") ??
          `pod server rejected the pod name (HTTP ${podResp.status})`,
        code: "SIGNUP_REJECTED",
      },
      { status: 400 },
    );
  }
  const podBody = (await safeJson(podResp)) ?? {};
  const webId = stringField(podBody, "webId") ?? "";
  const podRoot = stringField(podBody, "pod") ?? `${podBase}${podName}/`;
  if (!webId.startsWith("http")) {
    log.error("signup.no_webid", { body: clip(JSON.stringify(podBody), 200) });
    return NextResponse.json(
      {
        error: "pod server did not return a WebID; signup may have partially succeeded",
        code: "SIGNUP_AMBIGUOUS",
      },
      { status: 502 },
    );
  }

  try {
    createUser({
      ownerSlug: podName,
      webId,
      podRoot,
      email,
    });
  } catch (e) {
    // CSS-side creation succeeded but our registry write failed — log
    // and continue. The user can still reach /connect; the row will be
    // backfilled on the first repo-create after we wire that path.
    log.warn("signup.local_user_insert_failed", {
      detail: clip((e as Error).message ?? String(e), 200),
    });
  }

  log.info("signup.success", { ownerSlug: podName });
  return NextResponse.json({
    ok: true,
    webId,
    podRoot,
    connectUrl: `${env.bridgePublicUrl}/connect?webId=${encodeURIComponent(
      webId,
    )}&oidcIssuer=${encodeURIComponent(podBase)}`,
  });
}

function extractSetCookie(res: Response, name: string): string | null {
  const getSetCookie = (
    res.headers as unknown as { getSetCookie?: () => string[] }
  ).getSetCookie;
  if (typeof getSetCookie !== "function") return null;
  const lines = getSetCookie.call(res.headers);
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== name) continue;
    const rest = line.slice(eq + 1);
    const semi = rest.indexOf(";");
    const value = (semi < 0 ? rest : rest.slice(0, semi)).trim();
    return `${name}=${value}`;
  }
  return null;
}

async function safeJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function pickStringPath(obj: unknown, path: string[]): string | null {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "string" ? cur : null;
}

function stringField(
  obj: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === "string" ? v : null;
}
