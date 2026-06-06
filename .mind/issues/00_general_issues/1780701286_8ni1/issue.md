---
id: 01KTD13PQPNX2SDPK7B3CZ0176
slug: pages-publish-refresh-token-fails
type: bug
title: "Pages publish fails with \"refresh token failed\" for newly-connected WebIDs"
author: "http://localhost:3011/claude/profile/card#me"
authorKind: agent
created: 2026-06-06
afk: true
---

## What's wrong

Pushing to a prod repo succeeds and the repo viewer (`/repos/<owner>/<repo>`) works,
but the **Pages publish to the pod** never lands — `https://pod.mindpods.org/<owner>/public/sites/<repo>/`
404s. The repo UI shows:

> Owner needs to re-authorize via /connect → WebID `…/<owner>/profile/card#me` needs to
> reauthorize (refresh token failed)

The post-receive hook (`src/app/api/git/internal/post-receive/route.ts`) calls
`publishPages()` → `getOwnerFetch()` (`src/lib/solid/fetch-for-owner.ts`) →
`loadAuthedFetchForWebId()` (`src/lib/solid/oidc-server.ts`). That refresh fails for
**newly-connected** identities, so the pod write never happens. Pushing code and the
repo viewer are unaffected — only the owner-authed pod write in `publishPages()`.

**Evidence it's a server-side token regression, not a login-method problem:**
- A fresh interactive `/connect` (full browser OIDC, click Authorize) produces the
  **same** failure on the next publish — re-authorizing does not fix it.
- An older token (an identity connected earlier) still publishes fine — only
  newly-stored tokens fail to refresh.

**Most likely root cause:** `startAuthFlow`'s `session.login()` (`oidc-server.ts:45`)
never explicitly requests the `offline_access` scope, so newly-stored sessions may have
no usable refresh token to refresh against. (Rotation persistence and the storage-key
scheme in `identities.ts` already look correct — the merge in `makeIdentityStorage.set()`
and the `onNewRefreshToken` handler are in place — so #2/#3 from the report are likely
already handled.) The diagnostic logs already exist: `oidc.refresh.failed` distinguishes
`threw:true` from `isLoggedIn:false` with `rotationsDuringCall` — one real reproduction
disambiguates "no refresh token stored" from "IdP refused the refresh".

## Reproduce

1. Connect a brand-new WebID via `/connect` (or scripted `POST /api/auth/login`).
2. Create a repo, enable Pages with a non-empty `targetContainer`, push.
3. Repo viewer works, but `…/public/sites/<repo>/` 404s with the "refresh token failed"
   banner.

## Acceptance criteria

- [ ] Root cause confirmed against the prod pod with a real reproduction, using the
      existing `oidc.refresh.failed` log to pin down `no-refresh-token-stored` vs
      `IdP-rejected-refresh`.
- [ ] `startAuthFlow` requests `offline_access` (verify the SDK actually persists a real
      refresh token under the canonical `sessionId` on connect).
- [ ] A freshly `/connect`-ed WebID can `publishPages()` and the
      `…/public/sites/<repo>/` URL returns 200.
- [ ] An existing (older) identity still publishes — no regression.
