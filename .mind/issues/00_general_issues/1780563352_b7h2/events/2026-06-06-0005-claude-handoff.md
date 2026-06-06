---
id: 01JZWX11B0CLAUDE00RFH2150
kind: handoff
actor: "http://localhost:3011/claude/profile/card#me"
actorKind: agent
at: 2026-06-06T0005Z
to: review
---

**Verdict: acceptance is met by current code; the delta was the missing regression test, now added.**

**Arm 1 — "Bridge rehydrates pod auth across a restart" (verified, with refs):**
- The Inrupt node SDK persists the per-session record — DPoP `publicKey`/`privateKey` **and** `refreshToken` — through our `IStorage`, and reads them back on refresh (`getSessionFromStorage` → `getForUser(sessionId, "publicKey"/"privateKey"/"refreshToken")`, `@inrupt/solid-client-authn-node/dist/index.js` ~L526, L640).
- Our `IStorage` is the AES-256-GCM-encrypted, **SQLite-backed** `makeIdentityStorage` (`src/lib/registry/identities.ts:76`) — on disk, survives a process restart.
- `getOwnerFetch` reloads via `loadAuthedFetchForWebId` on **every** call — **no in-memory authed-fetch cache** (`src/lib/solid/fetch-for-owner.ts:51`, `oidc-server.ts:120`). So the next pod write after a restart rehydrates the session from SQLite and refreshes. The "in-memory DPoP lost" premise no longer holds.

**Arm 2 — "degrades to a single explicit re-connect prompt (no loop)" (verified, landed under #173):**
- A genuinely-failed refresh (revoked/expired token, dead client registration) is normalized to `OidcRefreshFailedError` → `OwnerFetchUnavailableError("needs-reauthorization")` → a clear `/connect` 503 (`fetch-for-owner.ts:57`), and the publisher records `needs-reauth` instead of retrying in a tight loop (`publisher.ts:170`). Covered by `tests/oidc-refresh-normalize.test.ts` + `tests/fetch-for-owner.test.ts`.

**The delta I built:** `tests/identity-storage-restart.test.ts` (2 tests) — pins arm 1's mechanism: writes the SDK's session blob (DPoP keypair + refresh token) through the encrypted storage, simulates a restart via `closeDb()`, re-opens a fresh storage instance over the same on-disk DB, and asserts the keypair + refresh token survive and decrypt (incl. the SDK's read-modify-write merge path not clobbering the keypair). Also asserts the row is AES-enveloped (`v1:`), never plaintext. A future "cache the keypair in memory for speed" regression fails here.

**Acceptance:**
- [x] Bridge rehydrates pod auth across a restart — verified (SQLite-persisted DPoP keypair + refresh token, on-demand reload) + new regression test.
- [x] degrades to a single explicit re-connect prompt (no loop) — verified (#173 normalization, publisher `needs-reauth`).

Checks: `npx tsc --noEmit` clean; `npm test` **67 passed** (was 65). No production-code change — this issue's behaviour was already correct; the gap was an untested invariant, now locked. Needs a human to review & land.
