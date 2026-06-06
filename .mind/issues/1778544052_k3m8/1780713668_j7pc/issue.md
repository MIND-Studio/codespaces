---
id: 01KTDCWGB7PF6ZQDOPEN0182
slug: rebuild-the-registry-index-from-the-pod-reconcile
type: feature
title: "Rebuild the Registry index from the pod + reconcile entry point"
author: "https://pod.mindpods.org/mind-agent-01/profile/card#me"
authorKind: human
created: 2026-06-06T02:41:08.968Z
epic: pod-owned-collaboration
afk: true
---

From `.scratch/pod-owned-collaboration` PRD (issue 07). Make "the pod is the
source of truth, the Registry is just an index" operationally real: a
`rebuildRepoFromPod` that reconstructs the index for a Repo by reading its
collaboration artifacts back from the pod.

- Add pod read/list to the collab store (`listIssuesFromPod`, `listCommentsFromPod`,
  `listPullsFromPod`), used only by rebuild.
- `rebuildRepoFromPod(repo)` walks `issues/` + `pulls/`, parses via `CollabRdf`,
  upserts by `(repo_id, number)`.
- Idempotent (second run = zero changes); pod-authoritative on conflict;
  non-destructive (pod-absent rows left untouched — destructive reconcile is out of scope).
- Operator-gated reconcile entry point (alongside the admin Pages reconcile)
  returning a change report (issues/comments/pulls added/updated/unchanged).

## Acceptance criteria
- [ ] After wiping the index, rebuild restores every Issue/Comment/PR to pod parity.
- [ ] Second run reports zero changes (idempotent).
- [ ] Conflict → index corrected to match pod; pod-deleted data not resurrected.
- [ ] Pod-absent index row left untouched (non-destructive).
- [ ] Operator-gated entry point returns a change report.
- [ ] Tests: wipe→rebuild→parity, idempotence, pod-authoritative conflict (store double).

Blocked by MC-178 (merge/close pod Turtle) and MC-179 (CollabRdf parse).
