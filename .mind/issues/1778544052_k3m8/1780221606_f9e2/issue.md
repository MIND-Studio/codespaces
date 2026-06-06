---
id: 01JZW0A0P0ALICE0OPEN0142    # ULID — canonical identity (= the open event). Never changes.
slug: pr-pod-native-turtle
type: feature
title: "Opening a PR writes pod-native Turtle"
author: "https://alice.example/profile/card#me"
authorKind: human
created: 2026-05-31T10:00Z
epic: EPIC_2026-05-12_E001
milestone: v0.9
afk: true                       # safe for an AFK agent to pick up
# NO `state:` here. Current state = fold of events/.
# Display handle MC-0142 is derived by the build, not stored.
---

## What to build

The first tracer bullet for pod-native Pull Requests. When a PR is opened on a Repo, write
its canonical Turtle into the owner's pod under the delegated connection, parallel to how
Issues are already written.

- Add a `solidgit:PullRequest` vocab term + `solidgit:closesIssue` predicate.
- Introduce `CollabRdf.renderPull`.
- Add `PodCollabStore.writePull`, mirroring the issue writer (container + ACL + PUT).
- Wire the PR-open path to trigger the pod write.

Pod path layout (parallels Issues):

```
{podRoot}/codespaces/{repo}/pulls/{n}/pull.ttl   (canonical PR body)
```

## Acceptance criteria

- [ ] Opening a PR writes `pulls/{n}/pull.ttl` with the agreed shape.
- [ ] `pulls/` container created idempotently, same ACL treatment as `issues/`.
- [ ] Agent-authored PR (no author) writes valid Turtle.
- [ ] `CollabRdf.renderPull` has a round-trip unit test.
- [ ] Per-PR static Preview still works (regression guard).

## Open question (for a human, not the agent)

Which ACL does the `pulls/` container inherit — public-read like `issues/`, or
member-only? This gates the membership epic. Raised on handoff; **not** for the agent to decide.
