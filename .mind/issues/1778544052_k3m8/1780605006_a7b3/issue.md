---
id: 01JZX00000HUHN00OPEN0160     # ULID — canonical identity (= the open event). Never changes.
slug: mind-issues-in-codespaces
type: feature
title: "Display .mind tracker issues in the codespaces Issues UI"
author: "https://huhn.example/profile/card#me"
authorKind: human
created: 2026-06-04T20:30Z
epic: EPIC_2026-05-12_E001
milestone: v0.9
afk: false                       # needs design alignment first — see open questions
# NO `state:` here. Current state = fold of events/.
# Display handle MC-0160 is derived by the build.
---

## What to build

Make the bridge's per-repo Issues surface (`/repos/{o}/{r}/issues`) read the repo's
**`.mind` tracker** instead of (or in addition to) the bespoke flat `issue.ttl`-per-issue
store it uses today. The `.mind` tracker already emits a SolidOS-conformant
`flow:Tracker` (`build/tracker.ttl` + `epics.ttl` + `state.ttl`); the dashboard should
render *that*, so a repo has **one** issue model end to end.

Then, because the whole `.mind/` folder is moving into the owner's pod (this epic's goal —
the collaboration record becomes canonical pod Turtle), the issues move with it: the
tracker the dashboard reads is the pod copy, not a working-tree file. `.mind` stays the
authoring layer (markdown folders + append-only `events/`); `tracker-build` folds it into
the pod-hosted `flow:Tracker`, and the Registry/SQLite index becomes a rebuildable
projection of that pod truth.

Net effect: **one tracker, three renderers** — the bridge dashboard, mind-issues
(open-by-URL), and SolidOS issue-pane — all reading the same `flow:Tracker`.

## Why

Today there are two divergent issue models in this repo: the bridge's flat, mutable
`issue.ttl`-per-issue (no epics, `status` string) and `.mind`'s epic-scoped,
event-sourced, `flow:Tracker`-conformant tracker. The `.mind` model is the canonical one
and already conforms to the Solid `IssueTrackerShape`; the bridge UI is the outlier.
Converging removes the duplicate model and gives real cross-tool interop.

## Acceptance criteria

- [ ] `/repos/{o}/{r}/issues` renders the repo's `.mind`-derived `flow:Tracker`
      (state = `rdf:type` subClassOf `flow:Open`/`flow:Closed`; epics via `mc:epic`).
- [ ] Issues are grouped by epic, with the un-epic'd `00_general` bucket shown as "General".
- [ ] The tracker is read from the **pod** copy (`{podRoot}/codespaces/{repo}/.mind/...`
      or agreed path), not the working tree — moving `.mind` into the pod is the source.
- [ ] `tracker-build` writes the `flow:Tracker` trio into the pod under the delegated
      connection (parallels how Issues/PRs are written), idempotent container + ACL.
- [ ] The Registry index is rebuildable from the pod tracker (projection, not source).
- [ ] The same tracker URL renders read-only in mind-issues (already supported) — regression check.

## Open questions (for a human, not the agent)

- **Single-doc vs multi-doc in the pod?** mind-issues edits single-doc (`flow:stateStore <>`);
  `.mind` emits multi-doc (`stateStore <state.ttl>` + `epics.ttl`). The bridge has concurrent
  human+agent writers, which argues for multi-doc + append-only — but that's the harder write
  path. Decide before implementing the pod writer.
- **Does the bridge's flat `issue.ttl` store get migrated and retired, or kept as a
  back-compat read?** Affects existing seeded repos (alice/notes #1/#2).
- **Where exactly does `.mind` live in the pod**, and what ACL does the tracker container
  inherit (public-read like `issues/`, or member-only)? Ties into epic 02 (membership).
