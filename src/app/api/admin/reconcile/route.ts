import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { reconcilePages } from "@/lib/pages/reconciler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operator-only manual reconciler trigger. Authenticates via the shared
 * `Authorization: Bearer ${BRIDGE_ADMIN_TOKEN}` secret — separate from
 * user sessions because this is a host-level operation, not a per-user
 * one. In dev (no admin token configured) the route 403s; operators must
 * set `BRIDGE_ADMIN_TOKEN` explicitly to enable it.
 */
export async function POST() {
  const env = getEnv();
  if (!env.adminToken) {
    return NextResponse.json(
      { error: "admin endpoint disabled (BRIDGE_ADMIN_TOKEN unset)" },
      { status: 403 },
    );
  }
  const hdrs = await headers();
  const presented = (hdrs.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!presented || presented !== env.adminToken) {
    return NextResponse.json({ error: "invalid admin token" }, { status: 401 });
  }
  const outcomes = await reconcilePages();
  return NextResponse.json({ outcomes });
}
