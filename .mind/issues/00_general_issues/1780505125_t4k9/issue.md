---
id: 01JZTC4K0A0HUHN00OPEN0171
slug: turbopack-stale-css-bundle
epic: none
type: bug
title: "Turbopack serves stale CSS after edits until .next is wiped"
author: "https://huhn.example/profile/card#me"
authorKind: human
created: 2026-06-03T16:45Z
milestone: v0.9
afk: true
---

## What's wrong

CSS changes don't show up in the served bundle — even after a dev-server restart — because the
cached bundle in `.next/` is stale. Confirmed with a new `.markdown-body ul` rule that stayed
absent until `rm -rf .next`. Costs minutes of "why isn't my change showing" every time.

## Acceptance criteria

- [ ] Document the wipe in the dev troubleshooting section (done in AGENTS.md), and
- [ ] add an `npm run dev:clean` script that wipes `.next` before starting.
