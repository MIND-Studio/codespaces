---
id: 01JZX00000CLAUDE00RFH160
kind: handoff
actor: "http://localhost:3011/claude/profile/card#me"
actorKind: agent
at: 2026-06-06T0036Z
to: review
---

**Built the full feature in one PR (per the design gate).** One tracker, mirrored into the pod, rendered from the pod, projected into the Registry.

**New modules:**
- `src/lib/solid/tracker-pod.ts` — `publishTrackerToPod` (ensure container + **public-read** ACL + PUT the `tracker.ttl`/`epics.ttl`/`state.ttl` trio at `{podRoot}/codespaces/{repo}/.mind/`, idempotent), `readPodTracker` (GET + `parseTrackerTrio`), `mirrorTrackerFromGit` (read committed `.mind/build/*.ttl` blobs → publish, fail-soft).
- `src/lib/tracker/source.ts` — `readRepoTracker`: **pod-first, git-fallback** seam.
- `src/lib/registry/issue-projection.ts` — `projectTrackerToRegistry`: upsert by stable `(repo_id, number)`, idempotent, leaves flat `issue.ttl` rows untouched.

**Wiring:**
- `post-receive` route mirrors the trio to the pod on **any push to the default branch** (consumer `tracker:build` *and* bridge-authored `createMindIssue`, whose push also lands here), then re-projects the pod tracker into the Registry — fire-and-forget, fail-soft.
- `issues/page.tsx` + `repo-tabs.tsx` now read via `readRepoTracker` (pod copy first).

**Acceptance:**
- [x] **C1** `/repos/{o}/{r}/issues` renders the `.mind`-derived `flow:Tracker` — already true (`readGitTracker`→`groupByEpic`); now sourced pod-first.
- [x] **C2** grouped by epic, `00_general` → "General" — `groupByEpic` (unchanged).
- [x] **C3** read from the **pod** copy, not the working tree — `readPodTracker` via `readRepoTracker` (git fallback keeps it safe).
- [x] **C4** `tracker-build` writes the trio into the pod under the delegated connection, idempotent container + ACL — `publishTrackerToPod` from the post-receive mirror.
- [x] **C5** Registry index rebuildable from the pod tracker (projection, not source) — `projectTrackerToRegistry`.
- [x] **C6** same tracker URL renders read-only in mind-issues — published `tracker.ttl` carries the `flow:Tracker` + `flow:stateStore` shape (asserted in `tracker-pod.test.ts`); public-read ACL makes it dereferenceable.

**Design decisions honoured:** full feature in one PR · multi-doc append-only (mirror the fold; authoring stays in `events/`) · `codespaces/{repo}/.mind/` public-read · flat `issue.ttl` kept as back-compat (projection coexists, never clobbers).

**Tests (+7):** `tests/tracker-pod.test.ts` (4 — publish/ACL/idempotency, `flow:Tracker` shape, pod read-back parse-grouped, null→git-fallback), `tests/issue-projection.test.ts` (2 — project-by-number idempotent + status flip, flat coexistence), and a deterministic `wf:assignee`-join case added to `tests/tracker-parse.test.ts` (decoupled from the live board, which now churns as issues are claimed/handed-off). Also de-brittled that file's `#150` assertions.

**Checks:** `npx tsc --noEmit` clean; `npm test` **74 passed** (was 67). `tracker:check` green.

**Integration-only (deferred, noted in AGENTS.md):** live-CSS mirror + pod read against a real CSS + a real bare-repo push round-trip. The pod I/O, ACL shape, projection, and parse are all unit-covered with an in-memory pod (the established inbox/packages pattern). Needs a human to review & land.
