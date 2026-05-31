# Future initiative: Multi-user collaboration (mentions, invites, sharing)

Status: needs-triage
Feature: multi-user-collaboration
Captured: 2026-05-31 — not yet grilled/specified. Pick this up after
`pod-owned-collaboration` lands. Then: /grill-with-docs → /to-prd → /to-issues.

## The gap

Mind Codespaces is single-tenant per Repo today. `owners.ts` says it outright:
"there's no membership model." A Repo has exactly one Owner; "orgs" (e.g. `mind`)
are just a badge; visibility is binary `public`/`private` and "private" only means
"gated by a Push token," not "shared with a specific person." Issue authorship is a
free WebID string, not a verified participant.

So GitHub-table-stakes social features — **@mentioning a user in an issue**,
**inviting a collaborator to a repo** — aren't missing functions; they're the
visible tip of a whole missing layer.

## What it actually requires (three layers)

1. **Membership / access model** — Repo ↔ many WebIDs with access roles
   (read / write / admin). Per the thesis, the collaborator list likely lives in
   the Owner's Pod (in Repo metadata), with the Bridge enforcing from pod ACLs.
2. **Cross-pod notification** — deliver mentions/invites to a participant's Pod
   `/inbox/` using the Mind spec's §4 LDN inbox + outbox (every Mind pod exposes
   `/inbox/` as a public-write Linked Data Notifications target; POST Turtle, a
   router worker dispatches by `mind:type`; "social mention" is a listed use case).
3. **Access granting across two planes** — (a) ACL grants on the Owner's pod
   resources (the Bridge can do this via the Owner's Connection), and (b)
   identity-aware **git** access on the Bridge (Push tokens are per-repo, not
   per-user, so collaborator write access needs a different model — the
   collaborator's own WebID recognized by the Bridge).

## The hard forks (why this needs a grill, not a straight build)

- **Where does the collaborator list live?** Owner's Pod (thesis-pure; Bridge
  reads ACLs) vs. Registry table (simpler; breaks the thesis).
- **Two access planes.** Sharing read on a private Pages site = ACL edit on the
  Owner's pod. Letting someone `git push` = Bridge-side identity, not a token.
- **Delivery vs. surfacing.** The Bridge can POST a mention to Bob's inbox on the
  Owner's behalf (LDN authenticates the *sender*; inbox is public-write) — clean.
  But *showing* Bob his mentions requires Bob connected to this Bridge, or reading
  his own inbox from his Dock. v0 simplification to decide.
- **Handle → WebID resolution.** "@bob" must resolve to a WebID. `/people` is a
  directory, but cross-pod handle resolution is unspecified.
- **Term collision.** Access roles (read/write/admin) vs. the agent `coder`/
  `reviewer` Roles already in `CONTEXT.md` — different meanings of "role" to
  disambiguate in the glossary.

## Dependencies & sequencing

- Depends on the deferred multi-user **identity** work — migration `012` left the
  `users`-table FK rewrite (binding `repos.owner` to a real User) as a follow-up;
  that likely needs to land first.
- Composes with `pod-owned-collaboration`: mentions reference pod-native
  Issues/Comments; invites attach to Repo metadata. Land that initiative first.
- Leans on the spec's shared-OIDC-issuer decision (SSO across sibling apps) for
  cross-app/cross-pod identity.

## New CONTEXT.md terms this will introduce (when grilled)

Collaborator / Member, Invite, Mention, Notification, Inbox / Outbox (LDN),
access Role (distinct from agent Role).
