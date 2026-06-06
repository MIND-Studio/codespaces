---
id: 01KTD13PQPNX2SDPK7B3CZ0176
kind: handoff
actor: "http://localhost:3011/claude/profile/card#me"
actorKind: agent
at: 2026-06-06T0124Z
to: ready-for-human
---

**The issue's primary hypothesis is falsified — do NOT just add `offline_access`.**

Investigated the full delegation chain against the actual Inrupt SDK + our storage:

- **AC2 (request `offline_access`) is a no-op.** `session.login()` omitting `scope`
  does **not** drop it: `solid-client-authn-core`'s `normalizeScopes` always prepends
  `DEFAULT_SCOPES = [openid, offline_access, webid]` even when the caller passes none
  (`node_modules/@inrupt/solid-client-authn-core/dist/index.js:230-239`). A refresh
  token *is* requested. Adding an explicit scope would "satisfy" AC2 while fixing nothing.
- **Storage layer is consistent — not the bug.** `getSessionFromStorage` wires our one
  `makeIdentityStorage` adapter as **both** secureStorage and insecureStorage, and
  `getKey` is the same `solidClientAuthenticationUser:<sessionId>` for both — so there's
  no secure/insecure split losing the token. Rotation persists (`saveSessionInfoToStorage`
  → `setForUser` → our `set()` merge). Report root-causes #2/#3 confirmed already-handled.

**So the failure is at live refresh time** — the IdP rejecting a stored token, or no
token persisted at connect — which the existing `oidc.refresh.failed` log's `threw` vs
`isLoggedIn` flag disambiguates. **Confirming it needs a real prod-pod reproduction**
(prod creds + browser OIDC consent against `pod.mindpods.org` + a real pushable repo) —
not safely doable headless here, so ACs 1/3/4 remain open for a human on the box.

**Delta I built (safe, no auth-flow behaviour change):** `completeAuthFlow`
(`src/lib/solid/oidc-server.ts`) now logs `oidc.connect.persisted { hasUserRecord,
hasRefreshToken }` right after the code exchange. Pair it with the later
`oidc.refresh.failed` line and the next prod repro is one-shot conclusive:
`hasRefreshToken:false` at connect ⇒ token never stored (look upstream at the IdP's
token response / dynamic-client registration); `hasRefreshToken:true` at connect but
`oidc.refresh.failed threw:true` later ⇒ IdP rejected the refresh (rotation / single-use
/ client-auth — check `error.message`). Checks: `npx tsc --noEmit` clean; `npm test`
**74/74**.

**Acceptance:** AC1 — *instrumented* (connect-time persistence now logged) but not yet
confirmed (needs the prod repro). AC2 — **falsified/N/A** (SDK already requests
`offline_access`; don't implement as written). AC3/AC4 — open, gated on the live repro +
whatever the logs reveal. Needs a human with prod access to reproduce, read the two log
lines, and apply the real fix. The `oidc.connect.persisted` instrument is the tool to do it.
