import "server-only";

/**
 * Best-effort display name for a WebID. We use the first non-empty path
 * segment, because every WebID we hand out follows the CSS shape
 * `http://host/{username}/profile/card#me`. Falls back to "owner" if
 * the URL is malformed.
 *
 * In a richer setup this would fetch FOAF `foaf:name` from the pod
 * profile, but a network round-trip per merge is overkill for the
 * prototype; the path-segment shortcut is correct for every seeded
 * identity (`alice`, `bob`, …) and degrades gracefully otherwise.
 */
export function displayNameForWebId(webId: string): string {
  try {
    const u = new URL(webId);
    const first = u.pathname.split("/").filter(Boolean)[0];
    return first || "owner";
  } catch {
    return "owner";
  }
}
