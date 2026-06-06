---
id: 01JZWX10A0BOB0000OPEN0150
slug: bridge-restart-auth-loop
epic: none
type: bug
title: "Bridge restart drops pod auth -> re-connect loop"
author: "https://bob.example/profile/card#me"
authorKind: human
created: 2026-06-04T08:55Z
# NO epic — lives in general/. An operational bug that doesn't belong to a feature epic (yet).
milestone: v0.9
afk: false                      # currently claimed (in-progress)
---

## What's wrong

After a bridge process restart, in-memory DPoP state is lost and the SDK can't reuse the pod
refresh token (prod CSS doesn't rotate it), so every pod write 401s and the UI drops into a
"please re-connect" loop. Repro: connect, restart the bridge container, attempt any pod write.

## Acceptance criteria

- [ ] Bridge rehydrates pod auth across a restart, or
- [ ] degrades to a single explicit re-connect prompt (no loop).
