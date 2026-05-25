import "server-only";
import { readSession } from "@/lib/auth/session";
import { displayNameForWebId } from "@/lib/solid/web-id";
import { getUserByWebId } from "@/lib/registry/users";
import { listRepos } from "@/lib/registry/repos";
import { AuthCta } from "./auth-cta";

function initialsForName(source: string): string {
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Reads the session server-side and hands off to the client `<AuthCta/>`.
 * Signed out → a plain Link to /login. Signed in → the initials/dropdown.
 */
export async function AuthCtaServer() {
  const session = await readSession();
  if (!session) {
    return <AuthCta session={null} />;
  }

  // Best-effort owner slug: prefer the users row (set on signup), fall
  // back to the first repo this WebID owns, then to a derived handle.
  const user = getUserByWebId(session.webId);
  let ownerSlug: string | null = user?.ownerSlug ?? null;
  if (!ownerSlug) {
    const repo = listRepos().find((r) => r.ownerWebId === session.webId);
    ownerSlug = repo?.owner ?? null;
  }
  const displayName = ownerSlug ?? displayNameForWebId(session.webId);

  return (
    <AuthCta
      session={{
        webId: session.webId,
        displayName,
        ownerSlug,
        initials: initialsForName(displayName),
      }}
    />
  );
}
