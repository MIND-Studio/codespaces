# Background pod-sync sweeper (auto-retry)

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/pod-owned-collaboration/PRD.md`

## What to build

A background loop that retries collaboration artifacts whose last pod write did
not succeed (`failed` / `pending`) until they reach `synced`, so a transient pod
outage or a since-repaired Connection self-heals without the owner doing anything.

- Periodically scan for artifacts (Issues, Comments, PRs) not in `synced` and
  re-attempt the pod write via `PodCollabStore`, updating sync state on the result.
- `needs-reauth` artifacts are retried once the owner's Connection is valid again.
- Built as a sibling of the existing Pages Reconciler, sharing its cadence
  machinery and coexisting without fighting it. (Decision to make during
  implementation: literally share one scheduler with the Pages Reconciler vs. run
  a second timer — prefer sharing if it doesn't complicate either loop.)

## Acceptance criteria

- [ ] Artifacts left in `failed`/`pending` are retried on a recurring cadence and
      transition to `synced` once the pod write succeeds.
- [ ] An artifact that failed due to an expired Connection syncs automatically
      after the owner re-connects, with no manual re-save.
- [ ] The sweeper and the Pages Reconciler run together without interfering
      (no double-publish, no lock contention).
- [ ] The chosen scheduling approach (shared vs. separate) is noted in the
      implementation, and logged at startup like the Reconciler.

## Blocked by

- #05 — Durable pod writes: sync state + visible drift (needs the sync-state fields)
