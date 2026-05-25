import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness probe — answers "the Node process is up and serving HTTP".
 * No registry / pod / docker checks; those belong on `/api/health`
 * (readiness). Kubernetes-style: livez never fails for slow deps, so
 * the orchestrator doesn't restart a healthy process just because CSS
 * is briefly slow.
 */
export function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
