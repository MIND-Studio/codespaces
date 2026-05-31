# Merging / closing a PR updates its pod Turtle

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/pod-owned-collaboration/PRD.md`

## What to build

Extend pod-native PRs so their canonical Turtle reflects the true lifecycle
outcome, not just the open state. When a PR is merged or closed, rewrite
`pulls/{n}/pull.ttl` in the owner's Pod.

- Merge: status → `merged`, add `solidgit:mergeSha` (the merge commit SHA), set
  the merged-at timestamp, bump `dcterms:modified`.
- Close (without merge): status → `closed`, set the closed-at timestamp, bump
  `dcterms:modified`.
- If the PR closes an Issue, ensure the `solidgit:closesIssue` link is present in
  the rewritten Turtle.

Reuse `PodCollabStore.writePull` and `CollabRdf.renderPull` from the PR-open
issue; this issue adds the merged/closed cases to the renderer and drives the
write from the merge and close paths.

## Acceptance criteria

- [ ] Merging a PR rewrites `pull.ttl` with `status "merged"`, the `mergeSha`, and
      the merged-at time.
- [ ] Closing a PR rewrites `pull.ttl` with `status "closed"` and the closed-at
      time.
- [ ] A merge that resolves an Issue records `solidgit:closesIssue` in the pod
      Turtle.
- [ ] `CollabRdf.renderPull` round-trip test extended to cover merged and closed
      cases (including `mergeSha` present).
- [ ] Merge/close pod-write failures do not fail the merge/close API request
      (the request still succeeds; the failure is recorded — see the durable-writes
      issue for the recording mechanism, which this issue's writes must feed).

## Blocked by

- #01 — Opening a PR writes pod-native Turtle (needs `writePull` + the PR Turtle shape)
