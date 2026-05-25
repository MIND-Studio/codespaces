import { NextResponse } from "next/server";
import { deleteIdentity } from "@/lib/registry/identities";
import { requireOwner, clearSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ webId: string }> };

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
