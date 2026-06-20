import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { issueSession } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { clip, log, scrubWebId } from "@/lib/log";
import { completeAuthFlow } from "@/lib/solid/oidc-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "mc-oidc-session";

export async function GET(req: Request) {
  const env = getEnv();
  const jar = await cookies();
  const sessionId = jar.get(COOKIE_NAME)?.value;
  if (!sessionId) {
    return NextResponse.json(
      { error: "no OIDC session cookie; start over at /connect" },
      { status: 400 },
    );
  }

  // Next.js gives us `req.url` based on the bind host (e.g.
  // `http://0.0.0.0:3010/...` when started with `-H 0.0.0.0`), but the
  // SDK strips OpenID params from this URL and sends it to /token as
  // redirect_uri. That must exactly match the value registered at
  // /authorize, which is BRIDGE_PUBLIC_URL/api/auth/callback. So rebuild
  // the URL from BRIDGE_PUBLIC_URL and preserve only the OAuth params.
  const search = new URL(req.url).search;
  const callbackUrl = `${env.bridgePublicUrl}/api/auth/callback${search}`;

  let webId: string;
  try {
    const completed = await completeAuthFlow({ sessionId, callbackUrl });
    webId = completed.webId;
  } catch (e) {
    // Log details server-side; return a stable opaque error to the
    // client so OIDC implementation hints aren't leaked in the body.
    log.error("auth.callback.failed", {
      detail: clip((e as Error).message ?? String(e), 200),
    });
    return NextResponse.json(
      { error: "OIDC flow failed", code: "OIDC_CALLBACK_FAILED" },
      { status: 500 },
    );
  }

  jar.delete(COOKIE_NAME);

  log.info("auth.callback.success", { webId: scrubWebId(webId) });

  // The completed OIDC flow proves control of `webId`. Issue our own
  // session cookie so subsequent API calls can be authorized without
  // re-running the OIDC dance.
  await issueSession(webId);

  // The callback can land in two shapes:
  //   1) a top-level browser nav (legacy /connect flow) — fall back to
  //      a 303 to /identities, which is what every existing client
  //      already handles.
  //   2) a popup window opened by the in-page auth modal — the popup
  //      reports success to its opener via postMessage and closes
  //      itself, so the parent page never reloads.
  // We can't tell the two apart server-side without round-tripping a
  // cookie through the OIDC dance, so we serve an HTML stub that runs
  // both branches client-side. `window.opener` is non-null only in case
  // (2); `window.close()` is a no-op when there is no opener anyway.
  const dest = `${env.bridgePublicUrl}/identities`;
  const payload = JSON.stringify({ type: "mc:auth:success", webId });
  // location.origin is the bridge's own origin (callback URL is on it),
  // which is the targetOrigin we want for postMessage.
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Signed in</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 2rem; color: #555; }
</style>
<p>Signed in. You can close this window.</p>
<script>
  (function () {
    try {
      if (window.opener && window.opener !== window) {
        window.opener.postMessage(${payload}, window.location.origin);
        window.close();
        return;
      }
    } catch (e) {
      /* fall through to full-page redirect */
    }
    window.location.replace(${JSON.stringify(dest)});
  })();
</script>`;
  return new NextResponse(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Don't cache: this URL gets reused per session.
      "Cache-Control": "no-store",
    },
  });
}
