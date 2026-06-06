---
id: 01JZWF9Q0A0CLAUDE0RFH00173
kind: handoff
actor: "http://localhost:3011/claude/profile/card#me"
actorKind: agent
at: 2026-06-05T2353Z
to: ready-for-human
---

**What changed (the delta):** `loadAuthedFetchForWebId` (`src/lib/solid/oidc-server.ts`) now wraps `getSessionFromStorage` in try/catch and normalizes a *thrown* refresh failure (a dead dynamic-client registration after a `.css-data` wipe → `invalid_client`/network) into `OidcRefreshFailedError`, the same structured error the returns-not-logged-in case already raised. Previously a thrown refresh escaped raw, slipped past `getOwnerFetch`'s `instanceof OidcRefreshFailedError` catch, and surfaced as an opaque 500 — the "silent write failure with no clear cause."

**Verified already-met behaviour (cite):** detection + surfacing of a dead registration was partly landed under P0-R2 — `getOwnerFetch` maps `OidcRefreshFailedError` → `OwnerFetchUnavailableError("needs-reauthorization")` (`fetch-for-owner.ts:56`), whose message points at `/connect`; routes render it as a clear 503 `OWNER_UNAVAILABLE` (e.g. `files/[...path]/route.ts:80`, `publisher.ts:169`). The gap was only the *thrown* refresh path. Deliberately did **not** auto-prune-then-seeded-fallback — that would violate P0-R2 (a connected-but-dead identity must never write under the operator account); the "surface a re-connect error pointing at /connect" arm of the acceptance OR is the correct resolution.

**Acceptance:**
- [x] Detect a dead delegated registration and surface a "re-connect required" error pointing at `/connect`, not a silent write failure — both refresh failure modes (throws / returns-not-logged-in) now funnel to `OidcRefreshFailedError` → `needs-reauthorization` 503.

**Tests (none existed for this path):** `tests/oidc-refresh-normalize.test.ts` (4 — thrown-refresh & non-logged-in both → `OidcRefreshFailedError`; never-connected → null; healthy → fetch) and `tests/fetch-for-owner.test.ts` (3 — stale identity → `needs-reauthorization` with **no** seeded fallback even when enabled; never-connected → seeded in dev; prod → throws).

Checks: `npx tsc --noEmit` clean; `npm test` 65 passed (was 58). Triaged into the queue on the owner's explicit request. Needs a human to review & land.
