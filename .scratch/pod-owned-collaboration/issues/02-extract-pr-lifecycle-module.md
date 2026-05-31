# Extract PrLifecycle as a pure, tested module

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/pod-owned-collaboration/PRD.md`

## What to build

Extract the Pull Request state machine and invariants out of the SQLite-coupled
store into a pure `PrLifecycle` module that performs no persistence, so the rules
are testable without a database and the merge/close work that follows is lower
risk. Behavior must be preserved — this is a refactor that exposes a clean,
testable seam.

The module owns:

- The status transitions: `open → merged`, `open → closed`; rejecting illegal
  transitions (e.g. merging or closing a PR that is not `open`).
- Per-Repo numbering (next number = max existing for that Repo + 1).
- The "at most one open PR per source→target branch pair" invariant (re-opening
  an existing source→target updates in place rather than creating a duplicate).

The persistence layer calls into `PrLifecycle` to decide the next state and the
stamps to write, then performs the write itself.

## Acceptance criteria

- [ ] PR transition logic lives in pure functions with no DB access.
- [ ] Unit tests cover: open→merged, open→closed, merge-of-non-open rejected,
      close-of-non-open rejected, per-Repo numbering increments correctly, and the
      single-open-per-branch-pair invariant.
- [ ] Existing PR open/merge/close behavior is unchanged (no API/response changes).
- [ ] No regression in existing PR-related tests.

## Blocked by

None - can start immediately
