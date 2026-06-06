---
id: 01KTDCWG6718ZXT1OPEN0181
slug: background-pod-sync-sweeper-auto-retry
type: feature
title: "Background pod-sync sweeper (auto-retry)"
author: "https://pod.mindpods.org/mind-agent-01/profile/card#me"
authorKind: human
created: 2026-06-06T02:41:08.807Z
epic: pod-owned-collaboration
afk: true
---

From `.scratch/pod-owned-collaboration` PRD (issue 06). A background loop that
retries collaboration artifacts whose last pod write didn't succeed
(`failed`/`pending`) until `synced`, so a transient outage or repaired Connection
self-heals. Sibling of the Pages Reconciler, sharing its cadence machinery.

- Periodically scan non-`synced` Issues/Comments/PRs and re-attempt the pod write
  via the collab store, updating sync state on the result.
- `needs-reauth` artifacts retry once the Connection is valid again.
- Coexist with the Pages Reconciler (no double-publish, no lock contention);
  decide shared-scheduler vs second-timer during implementation and log at startup.

## Acceptance criteria
- [ ] `failed`/`pending` artifacts retried on a recurring cadence → `synced`.
- [ ] An expired-Connection failure syncs automatically after re-connect, no manual re-save.
- [ ] Sweeper + Pages Reconciler run together without interfering.
- [ ] Chosen scheduling noted + logged at startup like the Reconciler.

Blocked by MC-180 (durable pod writes — needs the sync-state fields).
