# AGENTS.md — machine contract for `.mind`

This tracker is read and written by agents. These rules are binding. For *what* the tracker is and
how it's laid out, see [`README.md`](README.md); this file is only *how to operate it*.

## Reading — query, never slurp

- Use `yq`/`jq`. **Never** `cat` a whole `issue.md` or an `events/` dir into context.
- **Facts** come from `issue.md` frontmatter; **narrative** from its body; **state & history**
  from `events/`.
- **Current state is the fold of `events/`** — the `to:` of the latest state-changing event.
  There is no `state:` field on the issue; do not invent one.

```bash
# facts across all epics + 00_general
yq --front-matter=extract \
  'select(.priority == "high")' issues/**/issue.md

# current state of one issue = last state event's `to:`
yq --front-matter=extract '.to' \
  issues/01-pod-owned-collaboration/2026-05-31-pr-pod-native-turtle/events/*.md \
  | tail -1

# cheapest queries of all — the path itself
ls issues/01-pod-owned-collaboration/        # topics in this epic, by date
ls calendar/                                 # milestones in date order (filenames are date-first)
```

## Writing — events are the only way to change state

- **Change state = append one event file** to the issue's `events/`, named
  `<date>-<hhmm>-<actor>-<kind>.md`. Do not edit `issue.md`'s body to record state.
- **Claim before working.** Append a `claim` event with `ttl: PT2H`. If two agents claim,
  **lowest ULID wins**; the loser backs off. A claim past its ttl is stale — reclaimable.
- **Suggest, don't decide.** Put recommendations in the event body or `.ai/suggestions/`.
  Never author the human's decision. **Never self-close** — hand back with a `handoff`
  event to `ready-for-human`.
- **Respect gates.** Do not pick up issues labelled `human-only`, `needs-design`, or `blocked`.
- **Ship via** an `agent/issue-<handle>` draft branch; record it with a `link` event.

## Event kinds

`open` · `triage` · `claim` · `release` · `state` (generic transition) · `link` (PR/ref) ·
`comment` · `handoff` · `close`. Each is a markdown file with frontmatter (`id`, `kind`,
`actor`, `actorKind`, `at`, and `to:` if it moves state) + an optional prose body.

## Referencing issues

Reference an issue by its canonical **ULID** (`issue.md` `id:`), never by path or display handle —
a `git mv` (epic promotion, re-slug) must not break any reference. See *Identity* in
[`README.md`](README.md) for the three layers.
