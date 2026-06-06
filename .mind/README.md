# `.mind` — a Markdown, event-sourced issue tracker

An issue tracker that lives in the repo as plain files, built for **humans and agents to share
one source of truth**. Issues are folders, history is an append-only event log, and the current
state of everything is *derived* — never hand-set. No app required to read or write it; any editor,
`git`, and `yq` are enough.

- **Humans** browse the tree or read the generated `build/board.md`.
- **Agents** follow the contract in [`AGENTS.md`](AGENTS.md).
- **Tooling/CI** renders the Markdown into committed, Solid-conformant Turtle:
  `npm run tracker:build` folds `issues/**/events/` → `build/*.ttl` (a `flow:Tracker`), and
  `npm run calendar:build` renders `calendar/` → `calendar/build/calendar.ttl` (an `ical:Vcalendar`).

## The one idea that makes it work

> **The path carries immutable context. The `events/` log carries state.**

A folder name only ever encodes facts that never change — the epic, the topic, the date it was
filed. Everything that *moves* — open → in-progress → done, who claimed it, priority, labels,
links — lives in the issue's `events/` log. Current state is the **fold** of that log.

| Lives in the **path** (immutable) | Lives in **`events/`** (mutable) |
|---|---|
| epic (`01-pod-owned-collaboration/`) | current state (open → in-progress → done) |
| topic slug (`pr-pod-native-turtle/`) | who claimed it, when, ttl |
| created-at date (`2026-05-31-…/`) | priority/label changes, handoffs, links |

Because state lives in exactly one place, **status can't desync** — there's no `status:` field to
disagree with a folder, and no folder to disagree with a field. And because the path holds only
immutable facts, it's free to be human-meaningful *and* machine-stable:
`issues/01-pod-owned-collaboration/2026-05-31-pr-pod-native-turtle/` tells you the epic, the topic,
and when it was filed — and none of it ever moves, so references never break.

## Layout

Three top-level domains — **work** (`issues/`), **schedule** (`calendar/`), **rationale**
(`decisions/`) — plus config and the generated build.

```
.mind/
  README.md                         this file — what it is and how to use it
  AGENTS.md                         the machine contract (append events; query, don't slurp)
  issues/                           ALL tracked work
    tracker.config.md               states, categories, axes — AUTHORITATIVE vocab
    00_general/                     un-epic'd issues (00_ sorts it first, beside the epics)
      <created-date>-<slug>/        ONE issue = a folder. Path = topic + date.
        issue.md                    frontmatter (immutable facts) + prose body. NO state field.
        events/
          <date>-<hhmm>-<actor>-<kind>.md   append-only. The fold of these IS the state.
    NN-<epic-slug>/                 an EPIC — a goal + its issues
      EPIC.md                       the epic brief (goal, status) — AUTHORITATIVE
      <created-date>-<slug>/        issue folders sit directly under the epic (no inner issues/)
        issue.md
        events/
  calendar/                         dated events — milestones, releases, meetings, deadlines
    calendar.config.md              event types, statuses, namespace — AUTHORITATIVE vocab
    2026-06-30-v0.9-pod-collaboration.md   ← `ls` shows due dates in order, no file-read needed
    2026-07-31-prod-cutover.md
    2026-05-15-v0.8-pr-previews.md
    build/calendar.ttl              GENERATED — an ical:Vcalendar of all events
  decisions/                        this project's ADRs (the tracker's own design rationale lives
                                    in the Mind decision log — see decisions/README.md)
  build/                            GENERATED, committed — never hand-edit
    board.md                        every issue, folded to current state, grouped by epic
```

Two conventions worth calling out:

- **`tracker.config.md` sits inside `issues/`** — it configures the issues (states, categories,
  axes), so it lives with what it governs rather than at the tracker root.
- **`issues/00_general/` is the un-epic'd lane** — a real issue that doesn't belong to an epic yet.
  Promoting it later is a `git mv issues/00_general/<issue>/ issues/NN-<epic>/<issue>/`; the slug and
  date stay, so the identity survives the move.

## Issues

One issue = one folder named `<created-date>-<slug>/`, containing:

- **`issue.md`** — YAML frontmatter (immutable facts: `id`, `title`, `category`, `priority`,
  `milestone`, `labels`) followed by a prose body. **There is no `state:` field** — state is the
  fold of `events/`.
- **`events/`** — an append-only log; each file is `<date>-<hhmm>-<actor>-<kind>.md`. To move an
  issue's state, you *append an event*, never edit the body. The fold of the log is the state.

## The calendar — dated events (`calendar/`)

`calendar/` is a typed calendar of dated project events. Each event is one file with a `type`
(`milestone`, `release`, `meeting`, `deadline` — defined in `calendar.config.md`), a `date`, an
optional `status`, and a Markdown body. `npm run calendar:build` renders them into
`calendar/build/calendar.ttl` — an **`ical:Vcalendar`** of `ical:Vevent`s, conforming to the SolidOS
schedule shape, so a pod data browser reads the calendar natively. The event's type becomes part of
its `rdf:type` (`a ical:Vevent , :Milestone`), exactly like the issue tracker puts state/category in
`rdf:type`.

A **milestone** is just the `milestone` event type — a dated plan, not a tracked work item. It does
**not** list its issues; membership is *computed*: "the v0.9 milestone" = every issue whose
frontmatter says `milestone: v0.9`. Scope (which issues) and date (when) stay independent: an issue
can change milestone without touching the calendar, and a date can slip without touching any issue.

Calendar files **are** date-named (`2026-06-30-v0.9-…`) — the one place a mutable value is allowed
in a filename, because nothing references a calendar file *by path* (issues use the milestone **id**).
A slip is just a `git mv` to the new date, and `ls calendar/` gives a chronological agenda for free.

## Identity (three layers)

- **Canonical** = a ULID in `issue.md` frontmatter (`id:`), equal to the open event's id. Never
  changes. **References use the ULID**, so a `git mv` never breaks a link.
- **Display handle** (e.g. `MC-0142`) = derived by the build into `build/board.md`. Not stored on
  the issue.
- **Filename** = `<created-date>-<slug>/` — readable, sortable, and immutable context, *not* the
  identity.

## Why it's shaped this way

The reasoning behind every choice is recorded as ADRs in the **Mind decision log**, not here —
because they're design rationale for the Mind *issues* app and for Mind's base human+agent
collaboration:

- **Tracker design** — `architecture/src/decisions/apps/issues/`: state-in-events (0001),
  path-as-context (0002), milestones-as-calendar (0003), three-layer identity (0004),
  root layout (0005).
- **Cross-cutting base** — `architecture/src/decisions/architecture/`: storage-vs-agent-input
  (0008), AI-suggests-humans-commit (0009).

(From here: [`../../../architecture/src/decisions/`](../../../architecture/src/decisions/).)
