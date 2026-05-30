import { NextResponse } from "next/server";
import { deleteIdentity, getIdentityByWebId } from "@/lib/registry/identities";
import { requireOwner, clearSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webId: string }> };

/**
 * Report whether the bridge holds a delegated identity (pod-write grant) for
 * this WebID. Returns only a boolean — no token material — so it's safe to
 * expose for clients (e.g. the mind-builder onboarding) to decide whether to
 * prompt the user through `/connect` before their first publish.
 */
export async function GET(_req: Request, { params }: Params) {
  const { webId } = await params;
  const decoded = decodeURIComponent(webId);
  return NextResponse.json({ webId: decoded, connected: !!getIdentityByWebId(decoded) });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { webId } = await params;
  const decoded = decodeURIComponent(webId);
  // Only the holder of a WebID can disconnect that WebID's identity. The
  // session WebID is set at /api/auth/callback after a verified OIDC flow,
  // so this prevents a different authenticated user from disconnecting
  // someone else's pod.
  const auth = await requireOwner(decoded);
  if (!auth.ok) return auth.response;
  const ok = deleteIdentity(decoded);
  if (!ok) {
    return NextResponse.json(
      { error: "identity not found" },
      { status: 404 },
    );
  }
  // Disconnecting the identity invalidates the session that was issued
  // off that OIDC flow, so drop the cookie too — the next request will
  // be unauthenticated until the user reconnects.
  await clearSession();
  return NextResponse.json({ ok: true });
}
