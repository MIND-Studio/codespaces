/**
 * Single config source for the collaborative issue/epic composer (mirrors the
 * whiteboard's `src/lib/config.ts`). Don't read `process.env.NEXT_PUBLIC_*`
 * elsewhere — add a derived value here and import it.
 *
 * `NEXT_PUBLIC_*` is build-time-inlined: set `NEXT_PUBLIC_COLLAB_RELAY_URL`
 * before `next dev`/`next build` and hard-reload tabs after changing it.
 */

/**
 * The ephemeral y-websocket relay base URL.
 *  - dev default: the vendored relay on `:3012` (`npm run relay`).
 *  - prod: point this at the shared whiteboard relay — the relay is
 *    content-agnostic and the `mc:issue-draft:*` room namespace keeps the two
 *    apps' docs from colliding, so no codespaces-specific relay image is needed.
 */
export const collabRelayUrl = process.env.NEXT_PUBLIC_COLLAB_RELAY_URL ?? "ws://localhost:3012";

/**
 * The relay room id for one draft. Namespaced by app + repo so it never
 * collides with whiteboard rooms (or another repo's drafts) on a shared relay.
 * `WebsocketProvider` appends this to the relay base as the WS path.
 */
export function draftRoomName(owner: string, repo: string, draftId: string): string {
  return `mc:issue-draft:${owner}/${repo}/${draftId}`;
}

/**
 * Distinct, high-contrast cursor/presence colors; the index is chosen from the
 * Yjs clientID so a peer keeps the same color for the session with no
 * coordination. (Copied from the whiteboard's presence palette.)
 */
const CURSOR_COLORS = [
  "#2563eb", // blue
  "#16a34a", // green
  "#db2777", // pink
  "#9333ea", // purple
  "#0891b2", // cyan
  "#ea580c", // orange
  "#ca8a04", // amber
  "#65a30d", // lime
];

/** Deterministic color for a peer from its Yjs clientID (stable per session). */
export function colorForClient(clientId: number): string {
  return CURSOR_COLORS[Math.abs(clientId) % CURSOR_COLORS.length];
}

/**
 * Best-effort display name from a WebID. CSS WebIDs look like
 * `http://localhost:3011/alice/profile/card#me` → "alice".
 */
export function nameFromWebId(webId: string | null | undefined): string {
  if (!webId) return "Guest";
  try {
    const noFragment = webId.split("#")[0];
    const segments = noFragment.split("/").filter(Boolean);
    const meaningful = segments.filter((s) => s !== "profile" && s !== "card" && !s.includes(":"));
    return meaningful[0] ?? "Guest";
  } catch {
    return "Guest";
  }
}
