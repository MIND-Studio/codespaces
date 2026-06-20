/**
 * Browser-side helper: read the `mc-csrf` cookie (planted alongside the
 * session cookie at OIDC callback time) and produce the headers needed
 * for state-changing API calls.
 *
 * The session cookie is HttpOnly and not visible to JS; this readable
 * mirror is what closes the double-submit CSRF loop.
 */
export function csrfHeader(): Record<string, string> {
  if (typeof document === "undefined") return {};
  const match = document.cookie
    .split("; ")
    .map((c) => c.split("="))
    .find(([k]) => k === "mc-csrf");
  if (!match) return {};
  return { "X-CSRF-Token": decodeURIComponent(match[1] ?? "") };
}

/**
 * Drop-in wrapper around fetch that attaches both JSON content-type and
 * the CSRF header for state-changing requests. Use for all POST/PATCH/
 * PUT/DELETE calls from client components.
 */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET" && method !== "HEAD") {
    for (const [k, v] of Object.entries(csrfHeader())) headers.set(k, v);
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }
  return fetch(url, { ...init, headers });
}
