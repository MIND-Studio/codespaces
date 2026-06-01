import "server-only";
import { verifyPushToken } from "@/lib/registry/tokens";

/**
 * Registry push authentication. Packages reuse the repo's existing push
 * tokens (`scp_…`) — the same credential that authorizes `git push` also
 * authorizes publishing packages from that repo. No new token type.
 *
 * Two presentation forms are accepted because the clients differ:
 *   • npm sends `Authorization: Bearer <token>` (from `.npmrc` _authToken)
 *   • docker / curl / generic uploads send HTTP-Basic (token as password)
 */

/** Extract a presented token from either a Bearer or Basic auth header. */
export function readPackageToken(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (!auth) return null;

  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  if (bearer) return bearer[1].trim();

  const basic = /^Basic\s+(.+)$/i.exec(auth);
  if (basic) {
    try {
      const decoded = Buffer.from(basic[1], "base64").toString("utf-8");
      const colon = decoded.indexOf(":");
      // Username is ignored — any user with a valid token wins (mirrors the
      // Git Smart HTTP basic-auth behaviour).
      return colon < 0 ? null : decoded.slice(colon + 1);
    } catch {
      return null;
    }
  }
  return null;
}

/** True iff the request carries a valid push token for this repo. */
export function authenticatePackagePush(
  repoId: number,
  req: Request,
): boolean {
  const token = readPackageToken(req);
  return !!token && verifyPushToken(repoId, token);
}
