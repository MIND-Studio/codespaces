---
id: 01JZWF9Q0A0CLAUDE0OPEN0173
slug: css-data-wipe-stales-identities
epic: none
type: bug
title: "Wiping .css-data leaves stale identity rows that silently block pod writes"
author: "https://claude.example/profile/card#me"
authorKind: agent
created: 2026-06-04T12:10Z
milestone: v0.9
afk: false
---

## What's wrong

Wiping `.css-data/` invalidates every OIDC dynamic-client registration, but the bridge's
identity rows in SQLite stay. `getOwnerFetch` then refuses to fall back to seeded creds once a
*stale* delegated identity exists — so package/Pages writes fail with no clear cause, even in dev.

## Acceptance criteria

- [ ] Detect a dead delegated registration and either prune the row or surface a
      "re-connect required" error pointing at `/connect`, instead of a silent write failure.
