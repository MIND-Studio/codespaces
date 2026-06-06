---
id: 01KTDCVK3Y7WB2V5OPEN0180
slug: durable-pod-writes-sync-state-visible-drift
type: feature
title: "Durable pod writes: sync state + visible drift"
author: "https://pod.mindpods.org/mind-agent-01/profile/card#me"
authorKind: human
created: 2026-06-06T02:40:39.038Z
epic: pod-owned-collaboration
afk: true
---

From `.scratch/pod-owned-collaboration` PRD (issue 05). Replace the fire-and-forget
pod-write seam (`writeX(...).catch(log)`) with a recorded, visible outcome, so an
owner is never misled into thinking they own data that only exists on the Bridge.
Mirrors the Pages publish-status pattern.

- Add sync-state fields to the Issue/Comment/PR index tables (new migration):
  `pod_sync_status` (`synced|pending|failed|needs-reauth`), `pod_synced_at`,
  `pod_sync_error`; `pod_url` on PRs (issues/comments already have it).
- On create/update: attempt the write; record `synced`/`failed`/`needs-reauth`.
  **The API request still succeeds** — drift recorded, not swallowed.
- Surface sync state in API responses + a dashboard indicator; `needs-reauth`
  points at `/connect`. (Auto-retry is the separate sweeper issue.)

## Acceptance criteria
- [ ] Issues/Comments/PRs carry a `pod_sync_status` from the last write attempt.
- [ ] A failed write leaves the artifact visible with a `failed`/`needs-reauth`
      indicator; the request still returns success.
- [ ] `needs-reauth` surfaces a path to `/connect`.
- [ ] API responses include the sync-state fields.
- [ ] Tests: success→`synced`; fetch failure→`failed`; connection failure→
      `needs-reauth`; no throw/5xx on pod-write failure.
