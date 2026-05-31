# Durable pod writes: sync state + visible drift

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/pod-owned-collaboration/PRD.md`

## What to build

Replace the current best-effort, fire-and-forget pod-write seam (write attempted
in the background, failures only logged) with a recorded, visible outcome — so a
Repo owner is never misled into thinking they own data that only exists on the
Bridge. Mirrors the existing Pages publish-status pattern.

- Add sync-state fields to the Issue, Comment, and PR index tables (new numbered
  migration): `pod_sync_status`, `pod_synced_at`, `pod_sync_error`, and `pod_url`
  on PRs (Issues/Comments already carry `pod_url`).
- Sync status values: `synced | pending | failed | needs-reauth`.
- On create/update: attempt the pod write; record `synced` on success, `failed`
  on error, `needs-reauth` when the owner's Connection is the cause. **The API
  request still succeeds** — drift is recorded, not swallowed, and not blocking.
- Surface sync state in the relevant API responses and as a dashboard indicator,
  with `needs-reauth` pointing the owner at `/connect`.

This issue records outcomes; automatic retry is a separate issue (the sweeper).

## Acceptance criteria

- [ ] Issues, Comments, and PRs each carry a `pod_sync_status` reflecting the last
      pod-write attempt.
- [ ] A failed pod write leaves the artifact visible in the dashboard with a
      `failed` (or `needs-reauth`) indicator; the create/update request itself
      still returns success.
- [ ] A `needs-reauth` artifact surfaces a path to `/connect`.
- [ ] API responses for issues/comments/PRs include the sync-state fields.
- [ ] Tests assert: a successful write records `synced`; a fetch failure records
      `failed`; a Connection failure records `needs-reauth`; the request does not
      throw or 5xx on pod-write failure.

## Blocked by

- #01 — Opening a PR writes pod-native Turtle (PR writes must exist to be tracked)
