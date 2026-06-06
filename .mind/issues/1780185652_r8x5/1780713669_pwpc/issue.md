---
id: 01KTDCWGJ4DKRNH6OPEN0183
slug: grill-spec-multi-user-collaboration-mentions-invit
type: chore
title: "Grill + spec multi-user collaboration (mentions, invites, sharing)"
author: "https://pod.mindpods.org/mind-agent-01/profile/card#me"
authorKind: human
created: 2026-06-06T02:41:09.188Z
epic: multi-user-collaboration
afk: false
---

Captured from `.scratch/multi-user-collaboration/IDEA.md` (not yet grilled). The
membership/access-model layer is DONE (MC-157: pod-native `members.ttl` roster +
`requireMember`, roles reader/writer/admin). What remains is the social layer on
top — and it needs a `/grill-with-docs → /to-prd → /to-issues` pass before build,
so this is **human-led, not AFK**.

## Still open (the gap above membership)
- **@mention a user in an issue** + **invite a collaborator** — the visible tip of
  the missing social layer.
- **Cross-pod notification** — deliver mentions/invites to a participant's pod
  `/inbox/` via the Mind spec §4 LDN inbox/outbox (POST Turtle, router dispatches
  by `mind:type`).
- **Two access planes** — pod ACL grants (Bridge via owner Connection) vs.
  identity-aware **git** access (push tokens are per-repo, not per-user; collaborator
  write needs the collaborator's own WebID recognized by the Bridge).
- **Handle → WebID resolution** — "@bob" must resolve to a WebID; `/people` is a
  directory but cross-pod handle resolution is unspecified.

## Hard forks to grill (not a straight build)
- Where the collaborator list lives (pod metadata vs Registry) — MC-157 chose pod.
- Delivery vs surfacing (Bridge POSTs to Bob's inbox; showing Bob his mentions
  needs Bob connected here or reading from his Dock).
- Depends on the deferred multi-user **identity** work (migration 012's `users`-FK
  rewrite binding `repos.owner` to a real User likely lands first).

## Acceptance criteria
- [ ] Grilled (`/grill-with-docs`) → PRD → issue breakdown, with CONTEXT.md terms
      (Collaborator/Member, Invite, Mention, Notification, Inbox/Outbox, access Role
      vs agent Role) added.
- [ ] Sequencing decided relative to the deferred identity (`users`-FK) work.
