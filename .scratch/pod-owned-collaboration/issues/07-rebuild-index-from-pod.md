# Rebuild the Registry index from the pod + reconcile entry point

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/pod-owned-collaboration/PRD.md`

## What to build

Make "the Pod is the source of truth, the Registry is just an index"
operationally real: a `CollabIndex.rebuildRepoFromPod` operation that reconstructs
the Registry index for a Repo by reading its collaboration artifacts back from the
Pod. Wipe the index, reconcile, and every Issue, Comment, and PR returns from the
Pod.

- Add the pod read/list side to `PodCollabStore` (`listIssuesFromPod`,
  `listCommentsFromPod`, `listPullsFromPod`) used only by rebuild.
- `rebuildRepoFromPod(repo)` walks the `issues/` and `pulls/` containers, parses
  each resource via `CollabRdf`, and upserts the index by `(repo_id, number)`.
- Idempotent: a second run reports zero changes.
- Pod-authoritative on conflict: a stale index row is corrected to match the Pod,
  never the reverse.
- Non-destructive: rows whose pod resource is absent are left alone (destructive
  reconcile is explicitly out of scope per the PRD).
- Expose an operator-gated reconcile entry point (alongside the existing admin
  reconcile) that runs the rebuild for a Repo and returns a change report
  (counts of issues / comments / pulls added / updated / unchanged).

## Acceptance criteria

- [ ] After wiping the index for a Repo, `rebuildRepoFromPod` restores every
      Issue, Comment, and PR to parity with the Pod.
- [ ] Running reconcile twice reports zero changes on the second run (idempotent).
- [ ] On conflict, the index row is corrected to match the Pod; data deleted from
      the Pod is not resurrected into the index.
- [ ] An index row whose pod resource is absent is left untouched (non-destructive).
- [ ] The operator-gated reconcile entry point returns a change report.
- [ ] Tests cover: wipe→rebuild→parity, idempotence, and pod-authoritative
      conflict resolution (using a store double / known pod state).

## Blocked by

- #03 — Merging / closing a PR updates its pod Turtle (PRs must be fully in the pod to read back)
- #04 — Consolidate Issue/Comment/PR rendering into CollabRdf + round-trip parse (needs the `parse*` side)
