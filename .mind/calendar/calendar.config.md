---
title: "Mind Codespaces Calendar (.mind)"
description: "Dated project events — milestones, releases, meetings, deadlines. One Markdown file per event (date-first filename); `npm run calendar:build` renders build/calendar.ttl (an ical:Vcalendar). This frontmatter is the authoritative vocab."
namespace: "https://mindpods.org/ns/codespaces-calendar#"
# The event TYPE is part of an event's rdf:type (a ical:Vevent , :Milestone),
# mirroring how the issue tracker puts state/category in rdf:type.
eventTypes:
  - id: milestone
    label: "Milestone"
    color: "#6b46c1"        # a dated plan + goal date; membership computed from issues' milestone:
  - id: release
    label: "Release"
    color: "#16a34a"        # a shipped version, tagged on a date
  - id: meeting
    label: "Meeting"
    color: "#2563eb"        # has a time; attendees/location apply
  - id: deadline
    label: "Deadline"
    color: "#dc2626"        # a hard external date
# Optional lifecycle. Validated against an event's `status:` if present.
statuses:
  - id: planned
    label: "Planned"
  - id: confirmed
    label: "Confirmed"
  - id: hit
    label: "Hit"            # the goal date was met
  - id: slipped
    label: "Slipped"        # rescheduled — rename the file to the new date
  - id: cancelled
    label: "Cancelled"
# Generated — never hand-edit.
generated:
  - build/calendar.ttl
---

# Mind Codespaces Calendar — `.mind/calendar/`

This file's **YAML frontmatter is the source of truth** for the calendar's controlled vocabulary
(event types, statuses, namespace). `npm run calendar:build` reads it, loads every dated event in
this folder, and writes `build/calendar.ttl` — an `ical:Vcalendar` whose components are
`ical:Vevent` resources, conforming to the SolidOS schedule shape so a pod data browser can read it.

**One file per event**, named `YYYY-MM-DD-<slug>.md` (date-first, so `ls` is a chronological
agenda). Required frontmatter: `id`, `title`, `type` (∈ eventTypes), `date`. Optional: `endDate`,
`time`/`endTime` (HH:MM), `status` (∈ statuses), `location`, `attendees`, `links`, `tags`. The
Markdown body becomes `ical:comment`.

A **milestone** is just the `milestone` event type: a dated plan that issues join via `milestone:`
in *their own* frontmatter — the calendar owns the date, never the membership list.

Never hand-edit `build/*` — it is generated.
