# PRD: Pod-owned collaboration record

Status: ready-for-agent
Feature: pod-owned-collaboration
Glossary: see `CONTEXT.md` (Pod, Bridge, Repo, Registry, Repo metadata, Issue,
Comment, Pull Request, WebID, Owner, Connection, Reconciler, Publish)

## Problem Statement

The product promise of Mind Codespaces is "your pod is your platform" — your
identity, your code's metadata, your issues, and your published site all live in
a Solid Pod you own, and the Bridge is replaceable glue. Today that promise is
only partly true, and the gaps are exactly the ones a user discovers when they
try to *rely* on it:

- **My pull requests aren't in my pod.** When I open, merge, or close a Pull
  Request, nothing is written to my pod. If I move to a different Bridge, or the
  Bridge's disk is lost, every PR — its description, which branch it merged, the
  fact that it closed issue #7 — is gone. Issues survive (they're Turtle in my
  pod); PRs don't. The collaboration record is half-portable.
- **My pod can silently fall out of sync.** When I file an Issue or comment, the
  Bridge records it and *tries* to write it to my pod in the background. If that
  write fails (my Connection expired, the pod was briefly unreachable), I'm never
  told. The dashboard shows the Issue, but my pod doesn't have it — so the thing
  I supposedly "own" quietly diverges from what I see.
- **I can't actually rebuild from my pod.** The system says the pod is the source
  of truth and the Bridge's Registry is "just an index." But if that index is
  lost, there is no way to reconstruct it from my pod. The source-of-truth claim
  is aspirational, not operational — which means in practice the Bridge *is* a
  second source of truth I'm trusting.

For a real product, "you own your data" has to survive a Bridge migration, a lost
disk, an expired Connection, and a wiped index. Right now it survives none of
those for PRs, and only luckily for Issues.

## Solution

Complete the pod-owned collaboration record so the entire collaboration history —
Issues, Comments, **and Pull Requests** — lives in the owner's Pod as canonical
Turtle, the Registry becomes a genuinely rebuildable projection of that pod truth,
and pod writes are durable and visible rather than silent and best-effort.

Three capabilities, from the user's perspective:

1. **PRs become pod-native**, exactly like Issues: opening/merging/closing a PR
   writes canonical Turtle into my pod under a stable, world-readable path, using
   my own delegated Connection. A Solid-aware tool (or a future Bridge) can read
   my PR history without the original Bridge.
2. **Pod writes are durable and visible.** Every collaboration artifact carries a
   sync state (synced / pending / failed / needs-reauth). If a write to my pod
   fails, I see it, and a background sweeper retries it until it succeeds — the
   same shape as the existing Pages publish-status + Reconciler.
3. **The Registry can be rebuilt from my pod.** A reconcile operation walks my
   pod's collaboration containers, parses the Turtle, and reconstructs the index.
   Wipe the Registry, run reconcile, and every Issue, Comment, and PR comes back
   from the pod. This makes "the pod is the source of truth" operationally real.

This aligns with the existing decision that the Pod owns durable, shareable
artifacts and the Bridge is replaceable glue (spec ADR `codespaces/0001`); it
extends that decision's coverage from Issues to PRs, and closes the
"how would you actually rebuild?" follow-up.

## User Stories

1. As a Repo owner, I want each Pull Request I open to be written to my Pod as
   Turtle, so that my PR history is mine and not trapped on the Bridge.
2. As a Repo owner, I want merging a PR to update its canonical Turtle in my Pod
   (status `merged`, the merge commit SHA, the merged-at time), so that my Pod
   reflects the true outcome.
3. As a Repo owner, I want closing a PR without merging to update its Turtle to
   `closed`, so that the discarded-proposal state is recorded in my Pod.
4. As a Repo owner, I want a PR that closes an Issue to record that link in the
   Pod (PR → Issue), so that the "this work resolved that request" relationship
   survives independently of the Bridge.
5. As a Repo owner migrating to a different Bridge, I want my new Bridge to read
   my PRs from my Pod, so that I don't lose my collaboration history when I
   switch glue.
6. As a developer using a Solid-aware tool that isn't this Bridge, I want PRs to
   reuse standard vocab (`sioc:`/`foaf:`) alongside the project `solidgit:` term,
   so that my tool can read PR threads without learning a private schema.
7. As a Repo owner, I want PRs to live under a stable, world-readable pod path
   (parallel to `issues/`), so that links to my PRs are durable and shareable.
8. As a Repo owner, I want the Pod to remain the source of truth for PRs while the
   Registry stays a fast index, so that browsing PRs in the dashboard is quick but
   ownership stays with me.
9. As a Repo owner, when I file an Issue or comment, I want to be told if it
   couldn't be saved to my Pod, so that I'm never misled into thinking I own data
   that only exists on the Bridge.
10. As a Repo owner whose Connection expired, I want failed pod writes to be
    marked `needs-reauth` and to be pointed at `/connect`, so that I can fix it
    and have my pod catch up.
11. As a Repo owner, I want failed pod writes to be retried automatically in the
    background, so that a transient pod outage self-heals without my intervention.
12. As a Repo owner, I want to see the sync state of my Issues/Comments/PRs
    (synced / pending / failed) in the dashboard, so that drift between the Bridge
    and my Pod is visible rather than silent.
13. As a Bridge operator, I want a reconcile operation that rebuilds the Registry
    index from the Pod for a given Repo, so that I can recover from a lost or
    corrupted index without data loss.
14. As a Bridge operator, I want reconcile to be idempotent (running it twice
    changes nothing the second time), so that I can run it safely on a schedule or
    after an incident.
15. As a Bridge operator, I want reconcile to report what it changed (issues,
    comments, PRs added/updated), so that I can trust and audit a recovery.
16. As a Repo owner, I want reconcile to treat my Pod as authoritative on conflict
    (pod content wins over a stale index row), so that recovery never resurrects
    data I deleted from my Pod.
17. As the Coder agent, I want the PR I open on `agent/issue-{n}` to be pod-native
    like a human's PR, so that agent-authored history is as portable as
    human-authored history.
18. As a Repo owner, I want PR numbering to stay per-Repo and independent of Issue
    numbering, so that PR URLs remain stable and familiar.
19. As a Repo owner, I want at most one open PR per source→target branch pair, so
    that re-running the Coder on an issue updates the existing PR rather than
    spawning duplicates.
20. As a Repo owner, I want the `solidgit:PullRequest` Turtle to capture title,
    body, source branch, target branch, source SHA, status, author WebID, optional
    linked Issue, merge SHA, and timestamps, so that the Pod copy is complete
    enough to rebuild the index.
21. As a Repo owner, I want private-Repo PR Turtle to follow the same visibility
    rules already applied to that Repo's pod containers, so that PR exposure
    matches Repo visibility expectations.
22. As a developer, I want the PR Turtle shape and the Issue Turtle shape to share
    one rendering/parsing core, so that the two never drift apart in vocab or
    escaping.
23. As a Repo owner, I want a PR's static Preview to keep working unchanged, so
    that pod-native PRs don't regress the existing pre-merge preview feature.
24. As a Bridge operator, I want the background pod-sync sweeper to coexist with
    the existing Pages Reconciler without fighting it, so that the two
    self-healing loops don't conflict.

## Implementation Decisions

### Modules

Four modules, two of them deep and pure (the testable core), two wrapping I/O.

- **CollabRdf** *(new, pure, deep)* — the single render/parse core for all
  collaboration artifacts. Domain object ⇄ Turtle. Owns the `solidgit:`/`sioc:`/
  `foaf:` vocab, the triple-quoted-string escaping, and the resource/fragment
  layout. The hand-rolled Turtle currently inside the Solid issues writer moves
  here, and PR rendering is added alongside it. No I/O.
  - Interface: `renderIssue(repo, issue) → ttl`, `parseIssue(ttl) → Issue`,
    `renderComment(...) ⇄ parseComment(...)`,
    `renderPull(repo, pr) → ttl`, `parsePull(ttl) → PullRequest`.
  - Invariant under test: `parse(render(x)) deep-equals x` for every artifact.

- **PrLifecycle** *(new, pure, deep)* — the PR state machine and invariants,
  extracted from the current SQLite-coupled PR store so it can be tested without a
  DB. Decides legal transitions and numbering/uniqueness rules; performs no
  persistence.
  - Interface: `nextState(pr, action) → {status, stamps} | error`,
    `assertSingleOpenPerBranchPair(existingOpen, candidate)`,
    `nextNumber(maxExisting) → n`.

- **PodCollabStore** *(extend existing Solid writer)* — pod I/O for collaboration
  artifacts under the owner's delegated Connection: ensure containers, set ACLs,
  PUT Turtle (rendered by CollabRdf), and GET/list for rebuild. Generalizes the
  existing issue/comment pod writer to also handle PRs, and exposes read/list.
  - Interface: `writePull(repo, pr)`, `readPull(repo, n)`, `listPullsFromPod(repo)`,
    plus the existing `writeIssue`/`writeComment` and new
    `listIssuesFromPod(repo)` / `listCommentsFromPod(repo, n)`.
  - All writes return `{ url, mode, ok }` and never throw into the request path;
    the outcome drives sync state (below).

- **CollabIndex** *(new, projection)* — treats the Registry as a rebuildable
  projection. Reconciles the SQLite index from pod truth for one Repo.
  - Interface: `rebuildRepoFromPod(repo) → { issues, comments, pulls, updated,
    added, unchanged }`. Idempotent. Pod is authoritative on conflict (upsert by
    `(repo_id, number)`; never deletes pod-absent rows unless explicitly asked —
    see Out of Scope on destructive reconcile).

### Vocab

Add `solidgit:PullRequest` to the project namespace, reusing `sioc:Item` and
`foaf:`/`sioc:has_creator` the way Issues already do. PR → Issue links reuse a
`solidgit:` predicate (e.g. `solidgit:closesIssue`) pointing at the issue's pod
resource.

### Pod path layout (parallels Issues)

```
{podRoot}/codespaces/{repo}/pulls/                 (container, ACL mirrors issues/)
{podRoot}/codespaces/{repo}/pulls/{n}/             (per-PR container)
{podRoot}/codespaces/{repo}/pulls/{n}/pull.ttl     (canonical PR body)
```

### PR Turtle shape (decision, from the issues prototype generalized)

```turtle
<#pull>
    a solidgit:PullRequest, sioc:Item ;
    solidgit:number "N"^^xsd:integer ;
    solidgit:repository <…/codespaces/{repo}/index.ttl#repo> ;
    dcterms:title "…" ;
    sioc:content """…""" ;
    solidgit:status "open|merged|closed" ;
    solidgit:sourceBranch "…" ;
    solidgit:targetBranch "…" ;
    solidgit:sourceSha "…" ;
    solidgit:mergeSha "…" ;          # present once merged
    solidgit:closesIssue <…/issues/{m}/issue.ttl#issue> ;  # optional
    sioc:has_creator <webid> ;       # null author allowed (agent-authored)
    dcterms:created "…"^^xsd:dateTime ;
    dcterms:modified "…"^^xsd:dateTime .
```

### Durable pod-write seam (decision)

Replace the current fire-and-forget (`writeX(...).catch(log)`) with a recorded
outcome, mirroring the Pages publish-status pattern:

- Each indexed artifact gains a sync state: `pod_sync_status ∈ {synced, pending,
  failed, needs-reauth}`, `pod_synced_at`, `pod_sync_error`, and the canonical
  `pod_url`.
- On create/update: attempt the pod write; record `synced` on success. On
  failure, record `failed` (or `needs-reauth` when the Connection is the cause)
  and leave the row `pending`-able for retry. **The API request still succeeds** —
  responsiveness is preserved; drift is recorded, not swallowed.
- A background **pod-sync sweeper** (sibling to the Pages Reconciler, sharing its
  cadence machinery) retries `failed`/`pending` artifacts until `synced`.

### API contracts

- Existing PR routes (open/merge/close, list, detail) keep their shapes; their
  responses gain the sync-state fields. Merge/close now also drive a pod write.
- A reconcile entry point per Repo (operator-gated, alongside the existing admin
  reconcile) triggers `CollabIndex.rebuildRepoFromPod` and returns its report.

### Schema changes

- Add sync-state columns to the issues, issue_comments, and pull_requests index
  tables (`pod_sync_status`, `pod_synced_at`, `pod_sync_error`; `pod_url` already
  exists on issues/comments — add to pull_requests). New numbered migration(s).

## Testing Decisions

Good tests here assert **external behavior**, not internal wiring: given a domain
object, the rendered Turtle parses back to an equal object; given a sequence of
actions, the lifecycle reaches the right status; given a known pod state, a wiped
index rebuilds to parity. No test should assert on private function calls, SQL
text, or container-creation order.

Prior art: the existing unit tests (path-traversal, push-tokens, publisher walk,
quotas) under the project's `vitest` setup are the model — pure, fast, behavior-
level. The live-CSS publish round-trip is the model (and current backlog) for the
heavier integration tier (PRODUCTION-READINESS §3.2).

All four modules get tests (per the developer's decision):

- **CollabRdf** — round-trip property tests: `parse(render(x)) == x` for Issue,
  Comment, PR, including edge cases (empty body, labels, embedded `"""`,
  null author, optional `closesIssue`/`mergeSha`). Pure, no I/O. Highest value.
- **PrLifecycle** — state-machine tests: open→merged, open→closed, illegal
  transitions (merge-an-already-merged) rejected, single-open-per-branch-pair
  enforced, numbering increments per-Repo. Pure, no DB.
- **CollabIndex rebuild** — reconciliation tests against a store double: seed a
  known pod state, wipe the index, `rebuildRepoFromPod`, assert Issues/Comments/
  PRs come back to parity; assert idempotence (second run reports zero changes);
  assert pod-authoritative-on-conflict (a stale index row is corrected to match
  the pod, never the reverse).
- **PodCollabStore** — integration tests for pod writes/reads. Mock-fetch tier:
  assert PUT target URL, content-type, and Turtle body for each artifact, and that
  a failing fetch yields `ok:false` (never throws into the caller). A live-CSS
  round-trip variant joins the §3.2 integration backlog.

## Out of Scope

- **PR review comments / threaded PR discussion** in the pod (PRs get a body and
  lifecycle here; per-PR comment threads parallel to issue comments are a later
  PRD).
- **Moving git objects into the pod** — the Bare repo stays on Bridge disk; this
  PRD is about the *collaboration record*, not git history.
- **The worker-identity model** (Bridge acting as its own WebID + `hand.ttl`
  instead of the delegated owner) — unchanged here.
- **Destructive reconcile** — `rebuildRepoFromPod` only adds/updates index rows
  from pod truth; deleting index rows whose pod resource is gone is a separate,
  riskier operation deferred to its own PRD.
- **Managed multi-user, quotas, and the Pages-vs-agent product positioning** —
  separate "real product" PRDs.
- **Migrating existing Repos' historical PRs into the pod** — a one-shot backfill
  script can reuse `PodCollabStore.writePull` over `listPullRequests`, but the
  backfill itself is a follow-up, not part of this PRD's acceptance.

## Further Notes

- This PRD extends spec ADR `codespaces/0001` (pod owns durable artifacts; Bridge
  is glue) from Issues to PRs. It does not contradict it. If implementation
  reveals a genuine trade-off (e.g. awaiting pod writes inline vs. the sweeper),
  that's worth a new local ADR.
- The durable-write sweeper and the existing Pages Reconciler are deliberately the
  same shape; consider whether they should literally share a scheduler rather than
  run as two timers.
- Once reconcile exists, the migration-`004` comment ("a re-fetch from the pod
  would rebuild it") stops being aspirational — update that comment and the README
  to point at the real operation.
- `CONTEXT.md` should gain no new top-level terms from this work, but the PR entry
  can drop its `_v0 status_: registry-only` line once PRs are pod-native.
