---
id: 01JZW0B4T0CLAUDE0HAND20157
kind: handoff
actor: "http://localhost:3011/claude/profile/card#me"
actorKind: agent
at: 2026-06-06T0246Z
to: ready-for-human
prev: 01JZW0B3S0CLAUDE0CLAIM157
---

Implemented membership per [ADR-0002](../../../../docs/adr/0002-membership-bridge-mediated-capability.md).

**The delta built:**
- `src/lib/solid/members.ts` (new) — pod-native `members.ttl` roster (`WebID → role`,
  roles `reader`/`writer`/`admin`). Pure `renderMembersTurtle` + `readMembers` /
  `resolveMemberRole` / `addMember` / `removeMember` / `ensureMembers`, mirroring the
  `issues.ts`/`inbox.ts` idiom (delegated owner fetch, best-effort, hostile-WebID guard).
- `src/lib/solid/containers.ts` — `setMemberReadAcl` (owner R/W/Control + per-member
  `acl:Read`, no public) and `setVisibilityAcl` extended with an optional member list
  (private+members → member-read; private+none → owner-only; public → public-read).
- `src/lib/auth/session.ts` — `requireMember(repo, minRole)` generalises `requireOwner`:
  owner is implicit `admin` (no pod read), a non-owner's role is resolved from the pod
  roster; rank `reader<writer<admin`.
- `src/lib/solid/repo-metadata.ts` — provisions an empty roster (`ensureMembers`) and
  advertises `solidgit:members <members.ttl>` on `<#repo>`.
- `src/lib/solid/pulls.ts` — a freshly-created private `pulls/` now carries member-read
  (the #142-corollary container), read with the fetch already held.
- Routes: `GET/POST /api/repos/{o}/{r}/members` (list = `reader`, add = `admin`) and
  `DELETE /api/repos/{o}/{r}/members/{webid}` (admin). `src/lib/vocab.ts` doc updated.
- `tests/members-roundtrip.test.ts` (9 tests): render round-trip + hostile-WebID drop +
  dedup; add/read/update; **private repo grants member `acl:Read` on `pulls/` + roster
  doc**; **public repo gets no per-member ACL**; remove revokes; owner→admin resolution.

**Acceptance:**
- [x] Membership record lists WebIDs + roles — `members.ttl` (`renderMembersTurtle`,
  parsed back in the round-trip test).
- [x] Adding a member grants the matching pod ACLs — `addMember` → `applyMemberAcls`;
  private-repo `pulls/.acl` + `members.ttl.acl` carry the member `acl:Read` (pinned by
  test), public repos unchanged (already public-read).

Checks: `npx tsc --noEmit` clean; `npm test` **94 passed** (was 85, +9).

**Scope note for the reviewer (this is the WAC-sensitive part — `mc:afk false`):**
`requireMember` is delivered as the enforcement primitive and used by the new `/members`
routes, but I did **not** mass-rewire the ~30 existing `requireOwner` collab routes to
`requireMember` — that widens the write surface of every endpoint and is a per-route
human call. Recommend landing this infra, then migrating routes deliberately as a
follow-up. Live-CSS member-read enforcement + a Settings → Members UI are also follow-ups
(unit tests use an in-memory pod, per the project's integration-backlog convention).
Needs a human to review & land.
