import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * CORS allowlist for the JSON API (P0-S8 second half).
 *
 * The bridge's primary entrypoints are same-origin XHRs from the Next
 * pages it itself renders, plus the `git` CLI hitting `/api/git/...`.
 * Neither path needs cross-origin access. A real third-party integration
 * (a separate dashboard hosted elsewhere) can opt in via env:
 *
 *   BRIDGE_PUBLIC_URL=https://bridge.example.com      # always allowed
 *   BRIDGE_CORS_ALLOWED_ORIGINS=https://dashboard.example.com,https://ops.example.com
 *
 * Behaviour:
 *   • Preflight (OPTIONS): when Origin matches the allowlist, reply 204
 *     with the necessary Access-Control-* headers; otherwise 403.
 *   • Other requests: when Origin is set AND doesn't match, refuse with 403
 *     for /api/* routes (including state-changing ones). Same-origin requests
 *     (browsers omit Origin on same-origin GETs, or set it to the bridge's
 *     own origin) pass through.
 *   • The git Smart HTTP routes (`/api/git/.../[...path]`) are excluded —
 *     git CLI does not send Origin and CORS is not a relevant concern there.
 *
 * The proxy runs on the edge runtime by default, so it reads
 * `process.env` directly rather than going through getEnv() (which is
 * server-only / Node-runtime).
 */

const ALLOWED_ORIGINS = (() => {
  const set = new Set<string>();
  const pub = process.env.BRIDGE_PUBLIC_URL;
  if (pub) set.add(pub.replace(/\/$/, ""));
  const extra = process.env.BRIDGE_CORS_ALLOWED_ORIGINS;
  if (extra) {
    for (const raw of extra.split(",")) {
      const o = raw.trim().replace(/\/$/, "");
      if (o) set.add(o);
    }
  }
  // Dev convenience: in dev the bridge runs at :3010 and may also be
  // proxied through :3011 (the local CSS) during integration testing.
  if (process.env.NODE_ENV !== "production") {
    set.add("http://localhost:3010");
    set.add("http://127.0.0.1:3010");
  }
  return set;
})();

function isAllowed(origin: string | null): boolean {
  if (!origin) return true; // same-origin requests omit Origin
  return ALLOWED_ORIGINS.has(origin.replace(/\/$/, ""));
}

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Exclude git Smart HTTP and asset routes.
  if (pathname.startsWith("/api/git/")) return NextResponse.next();
  if (!pathname.startsWith("/api/")) return NextResponse.next();

  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    if (!isAllowed(origin)) {
      return new NextResponse(null, { status: 403 });
    }
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin ?? "*",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization,X-CSRF-Token,X-Mind-Dev-WebId",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
      },
    });
  }

  if (!isAllowed(origin)) {
    return NextResponse.json(
      { error: "origin not in CORS allowlist", code: "CORS_DENIED" },
      { status: 403 },
    );
  }

  // Allowed: reflect Origin on the response (only when one was sent).
  const res = NextResponse.next();
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  return res;
}

export const config = {
  matcher: "/api/:path*",
};
