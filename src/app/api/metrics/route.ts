import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { renderExposition } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Prometheus scrape endpoint. Authentication is the operator's
 * shared bearer (`BRIDGE_METRICS_TOKEN`); without it set, the route
 * 403s so a typo in the deploy doesn't leak metrics. The token is
 * separate from BRIDGE_ADMIN_TOKEN so the scraper credentials can be
 * rotated independently of operator credentials.
 */
export async function GET() {
  const expected = process.env.BRIDGE_METRICS_TOKEN?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "metrics endpoint disabled (BRIDGE_METRICS_TOKEN unset)" },
      { status: 403 },
    );
  }
  const hdrs = await headers();
  const presented = (hdrs.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!presented || presented !== expected) {
    return NextResponse.json({ error: "invalid metrics token" }, { status: 401 });
  }
  return new NextResponse(renderExposition(), {
    status: 200,
    headers: {
      // Prometheus content type; version=0.0.4 is the current exposition spec.
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    },
  });
}
