# `decisions/` — this project's decision records

This folder holds **mind-codespaces' own** architecture decisions (ADRs) — *why this project* is
shaped the way it is. One file per decision, append-only, supersede-don't-edit.

> Empty for now: mind-codespaces' product decisions currently live in
> [`../../docs/adr/`](../../docs/adr/) and in the Mind decision log under
> `architecture/src/decisions/apps/codespaces/`. As project-specific calls are made *through the
> tracker*, capture them here.

## This is not where the tracker's *own* design lives

The decisions about **how this tracker is built** (state-in-events, path-as-context,
milestones-as-calendar, identity, layout, storage-vs-agent-input, AI-suggests-humans-commit) are
**not** mind-codespaces decisions — they're design rationale for the Mind *issues* app and for Mind's
base human+agent collaboration. They live in the Mind decision log:

- **Tracker-app design** → `architecture/src/decisions/apps/issues/` (0001–0005)
- **Cross-cutting base** → `architecture/src/decisions/architecture/` (0008 storage-vs-agent-input,
  0009 AI-suggests-humans-commit)

(From this folder: `../../../../architecture/src/decisions/`.)

Keeping them there means any project that adopts this tracker format shares one rationale, and a
project's own `decisions/` stays about *that project*.
