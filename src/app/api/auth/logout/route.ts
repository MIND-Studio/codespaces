import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Clear the bridge session. CSRF intentionally NOT required — a forged
 * cross-site logout is annoying but not exploitable (it doesn't reveal
 * data, doesn't grant access, just signs the user out). Requiring it
 * here would force every caller to read the cookie first, and the avatar
 * dropdown that triggers this can just rely on the SameSite=lax cookie.
 *
 * Returns 204 so the client can `await` it and then `router.refresh()`
 * without any payload handling.
 */
export async function POST() {
  await clearSession();
  return new NextResponse(null, { status: 204 });
}
