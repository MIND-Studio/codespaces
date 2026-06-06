---
id: 01KTD13PQPNX2SDPK7B3CZ0176
kind: handoff
actor: "http://localhost:3011/claude/profile/card#me"
actorKind: agent
at: 2026-06-06T0135Z
to: ready-for-human
---

**Root cause found + fixed (supersedes the prior handoff).** The original commit
message (`a0d2bd5`) is the real clue: *"can't write after **one successful publish** —
refresh fails silently with `isLoggedIn=false`."*

**Root cause:** `loadAuthedFetchForWebId` called `getSessionFromStorage(...,
{ refreshSession: true })` on **every** publish, forcing a refresh-token spend each time.
Solid pods (CSS) issue **single-use** refresh tokens, so publish #1 consumed the token
and publish #2 reused a now-consumed token → the SDK returned `isLoggedIn:false` → the
"refresh token failed" banner, permanently. Not the `offline_access` scope (the SDK
already requests it) and not our storage/merge (rotation persists correctly — verified
against the SDK source).

**The delta:**
- `src/lib/solid/oidc-server.ts` — in-process **session cache** keyed by WebID. A healthy
  refresh caches the live `session.fetch` until just before `session.info.expirationDate`
  (minus a 60s skew); subsequent publishes within the access token's lifetime reuse it
  instead of refreshing. Refreshes drop from once-per-publish to ~once-per-token-lifetime,
  so the single-use refresh token is no longer burned on every request. Invalidates on
  re-`/connect` (sessionId change) and on expiry. New export `clearCachedSession(webId)`.
- `src/app/api/identities/[webId]/route.ts` — disconnect now calls `clearCachedSession`
  so a removed identity stops serving writes off a still-valid cached token.
- `completeAuthFlow` also logs `oidc.connect.persisted { hasRefreshToken }` (from the
  earlier pass) — keep it; it confirms connect-time token storage if a pod ever behaves
  differently.

**Tests:** new `tests/oidc-session-cache.test.ts` (4) — reuse-while-valid (only one
refresh for two publishes), re-derive on sessionId change, re-derive within expiry skew,
`clearCachedSession` forces refresh. `npx tsc --noEmit` clean; `npm test` **78/78** (was 74).

**Acceptance:** AC1 root cause confirmed by SDK-source analysis + the `isLoggedIn:false`
signature (plus the connect-time log for belt-and-suspenders). AC2 — N/A as written
(`offline_access` already requested); the real fix is the refresh-frequency cache. AC3/AC4
— **need a live prod re-verify on the box** (push twice from a freshly `/connect`-ed WebID;
`…/public/sites/<repo>/` should 200 on the second push too, and an older identity must
still publish). That live check is the only thing I can't run from here. Needs a human to
review, run the two-push prod verification, and land.
