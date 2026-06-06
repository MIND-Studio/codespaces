---
id: 01KTDCTDJTFP9P30OPEN0177
slug: extract-prlifecycle-as-a-pure-tested-module
type: refactor
title: "Extract PrLifecycle as a pure, tested module"
author: "https://pod.mindpods.org/mind-agent-01/profile/card#me"
authorKind: human
created: 2026-06-06T02:40:00.602Z
epic: pod-owned-collaboration
afk: true
---

Extracted from `.scratch/pod-owned-collaboration` PRD (issue 02). Extract the PR
state machine + invariants out of the SQLite-coupled store into a pure
`PrLifecycle` module (no persistence), so the rules are testable without a DB and
the merge/close work is lower-risk. Behaviour-preserving refactor exposing a
clean seam.

Owns: status transitions (`open→merged`, `open→closed`, reject illegal e.g.
merge/close of a non-open PR); per-Repo numbering (max+1); the "at most one open
PR per source→target branch pair" invariant (re-open updates in place).

## Acceptance criteria
- [ ] PR transition logic in pure functions, no DB access.
- [ ] Unit tests: open→merged, open→closed, merge-of-non-open rejected,
      close-of-non-open rejected, per-Repo numbering increments, single-open-per-
      branch-pair enforced.
- [ ] Existing PR open/merge/close behaviour unchanged (no API/response changes).
- [ ] No regression in existing PR tests.
