---
id: 01KTDCVJMTBYCVVJOPEN0178
slug: merging-closing-a-pr-updates-its-pod-turtle
type: feature
title: "Merging / closing a PR updates its pod Turtle"
author: "https://pod.mindpods.org/mind-agent-01/profile/card#me"
authorKind: human
created: 2026-06-06T02:40:38.555Z
epic: pod-owned-collaboration
afk: true
---

From `.scratch/pod-owned-collaboration` PRD (issue 03). PR-open already writes
`pulls/{n}/pull.ttl` (shipped as MC-142); this extends it so the canonical Turtle
reflects the lifecycle outcome. Reuse `writePullToPod` + the PR renderer; add the
merged/closed cases and drive the write from the merge & close routes (today
`writePullToPod` fires only on open).

- Merge: status → `merged`, add `solidgit:mergeSha`, set merged-at, bump `dcterms:modified`.
- Close (no merge): status → `closed`, set closed-at, bump `dcterms:modified`.
- Preserve `solidgit:closesIssue` in the rewritten Turtle.

## Acceptance criteria
- [ ] Merge rewrites `pull.ttl` with `status "merged"`, `mergeSha`, merged-at.
- [ ] Close rewrites `pull.ttl` with `status "closed"` + closed-at.
- [ ] A merge resolving an issue records `solidgit:closesIssue`.
- [ ] Renderer round-trip test extended for merged/closed (incl. `mergeSha`).
- [ ] Pod-write failure on merge/close does not fail the API request (feeds the
      durable-writes recording mechanism).
