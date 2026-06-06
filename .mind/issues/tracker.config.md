---
title: "Mind Codespaces Tracker (.mind)"
description: "Epic-scoped, event-sourced. Issues are markdown folders with an append-only events/ log; `npm run tracker:build` folds events to build/board.md (and optional Turtle). This frontmatter is the authoritative vocab."
namespace: "https://mindpods.org/ns/codespaces-tracker#"
initialState: needs-triage
# Current state is the FOLD of an issue's events/ — never a field on issue.md.
# These are the legal `state:` values an event may transition `to:`.
states:
  - id: needs-triage
    label: "needs triage"
    open: true
    handoff: human
  - id: ready-for-agent
    label: "ready for agent"
    open: true
    handoff: agent          # an agent may pick this up
  - id: ready-for-human
    label: "ready for human"
    open: true
    handoff: human          # agent hands back here; never self-closes
  - id: in-progress
    label: "in progress"
    open: true
  - id: blocked
    label: "blocked"
    open: true
  - id: done
    label: "done"
    open: false
  - id: wontfix
    label: "won't fix"
    open: false
# Issue categories (the `type:` axis).
categories:
  - id: feature
  - id: bug
  - id: refactor
  - id: chore
  - id: docs
# The four orthogonal axes a triager sets. type+priority+state+labels (+epic, +milestone).
axes:
  type: categories
  state: states
  priority: [urgent, high, normal, low]
  labels: open-set        # area:*, security, needs-design, human-only, blocked
# Coordination for multi-agent work (claim before working).
coordination:
  claimTtl: PT2H
  tieBreak: lowest-ulid
  queueGateLabels: [human-only, needs-design, blocked]
# Where milestone dates live (the calendar owns the date; issues only reference the id).
milestoneSource: calendar/
# Generated — never hand-edit.
generated:
  - build/board.md
---

# Mind Codespaces Tracker — `.mind`

This file's **YAML frontmatter is the source of truth** for the controlled vocabulary
(states, categories, axes, coordination). `npm run tracker:build` reads it, folds every
issue's `events/` log to a current state, and writes `build/board.md`.

- **State** is derived, not declared — it is the `to:` of an issue's latest state-changing
  event. No issue carries a `state:` field; that's the one rule that prevents desync.
- **Categories** = the `type:` axis. **Priority/labels** are the other two triage axes.
- **Milestones** are not listed here — they are calendar entries under `calendar/`, and an
  issue joins one via `milestone:` in its own frontmatter.

Never hand-edit `build/*` — it is generated.
