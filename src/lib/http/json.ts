import "server-only";
import { NextResponse } from "next/server";

/**
 * Response-size cap for JSON API routes (P0-S8 second half).
 *
 * A list endpoint with unbounded pagination — listIssues, listRepos,
 * listRuns — can shovel megabytes through Next's JSON path on a single
 * request, both wasting bridge memory and giving an attacker a cheap
 * amplification primitive. This helper is a drop-in replacement for
 * `NextResponse.json(data, init)` that:
 *
 *   1. Serialises `data` once.
 *   2. Refuses to ship the response if it exceeds MAX_RESPONSE_BYTES,
 *      returning 500 with a stable error envelope instead of leaking a
 *      truncated body the client can't trust.
 *   3. Otherwise builds the NextResponse from the pre-serialised bytes,
 *      with Content-Length set explicitly.
 *
 * Default cap: 5MB. Override via BRIDGE_MAX_JSON_RESPONSE_BYTES.
 */

const MAX_RESPONSE_BYTES = (() => {
  const raw = process.env.BRIDGE_MAX_JSON_RESPONSE_BYTES;
  const n = raw ? Number(raw) : 5 * 1024 * 1024;
  return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024;
})();

export function jsonResponse(data: unknown, init: ResponseInit = {}): NextResponse {
  const body = JSON.stringify(data);
  const bytes = Buffer.byteLength(body, "utf-8");
  if (bytes > MAX_RESPONSE_BYTES) {
    console.warn(
      `[http.json] refusing oversized response (${bytes} bytes > ${MAX_RESPONSE_BYTES} cap)`,
    );
    return NextResponse.json(
      {
        error: "response too large",
        code: "RESPONSE_TOO_LARGE",
        size: bytes,
        max: MAX_RESPONSE_BYTES,
      },
      { status: 500 },
    );
  }
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Content-Length", String(bytes));
  return new NextResponse(body, { ...init, headers });
}
