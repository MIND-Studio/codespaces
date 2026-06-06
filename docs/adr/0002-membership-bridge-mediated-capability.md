# 0002 — Repo membership is a bridge-enforced capability, not a pod WAC write-grant

Status: **Accepted** (2026-06-06) — unblocks `.mind` issue #157 (`membership-access-model`)

## Context

Today a repo has exactly one principal: its owner. `requireOwner(repo.ownerWebId)`
(`src/lib/auth/session.ts`) gates every mutation, and every pod write — issues,
the tracker mirror, proposals/inbox, packages, Pages — is **bridge-mediated with
the owner's *delegated* fetch** (`getOwnerFetch`, `src/lib/solid/fetch-for-owner.ts`).
The repo and all its bytes live in the **owner's** pod under
`{ownerPodRoot}/codespaces/{repo}/`. (`collab_enabled`, migration `017`, is only
the real-time co-authoring toggle — it is *not* a membership model.)

Issue #157 asks: **how does a second WebID gain access to a repo?** Specifically —
where the membership record lives, what WAC/ACP grants it implies, and how the
bridge reads it to authorize collaboration writes. This was gated `needs-design`,
and the answer also resolves the open "public-vs-member ACL" question on #142
(`pr-pod-native-turtle`, the delegated pod-native PR-write path).

The structural fork:

1. **Who physically writes to the pod for a member** — the bridge (as the owner,
   like everything else today), or the member (with their own WAC `acl:Write`
   grant on the owner's pod)?
2. Where the membership record lives, and what pod-level ACL changes adding a
   member actually makes.

## Decision

**Membership is a bridge-enforced *capability*. The bridge stays the sole writer
to the owner's pod; a member is an entry the bridge reads and authorizes against —
not a WAC write-principal on someone else's pod.**

- **Record:** a pod-native `members.ttl` in the owner's pod at
  `{ownerPodRoot}/codespaces/{repo}/members.ttl`, listing `WebID → role`. It is
  owner-writable, advertised off `<#repo>` for discoverability, and read by the
  bridge through the owner's delegated fetch — the same pattern as repo-metadata
  and the tracker mirror. Roles: **`reader` / `writer` / `admin`** (the owner is
  an implicit `admin`; `admin` may edit `members.ttl` and settings).
- **Enforcement:** `requireOwner(ownerWebId)` generalises to
  `requireMember(repo, minRole)`. A member authenticates to the **bridge** (the
  same session they already use for their own repos); the bridge performs the pod
  write **as the owner** via `getOwnerFetch`. Validation, rate-limits, CSRF, and
  the publish-lock all keep applying unchanged.
- **The only real pod WAC change:** a member **`Read`** grant on **private** repos
  (public repos are already public-read via `setPublicReadAcl`). Members never
  receive direct WAC **write** on the owner's pod.
- **#142 corollary:** `pulls/` Turtle is written bridge-mediated with the repo's
  *visibility* ACL — public-read for public repos, owner+member-read for private.
  Members contribute *through* the bridge; they do not write the owner's pod
  directly.

### Rejected alternative — direct WAC delegation

Adding a member writes real `acl:Write`/ACP grants into the owner's pod so the
member writes directly with their own credentials. More "Solid-native", but:

- It is the **single** place that would break the bridge-as-sole-writer invariant
  the whole system is built on (delegated-owner writes, P0-R2).
- **Revocation is non-atomic** — grants spray across many resources and must each
  be torn down; a capability row/triple is removed in one write.
- A member writing into *another person's* pod means **cross-pod auth**: their
  fetch must satisfy the owner's issuer/CORS, reintroducing exactly the OIDC and
  CORS friction the bridge exists to absorb.
- It **bypasses** the bridge's validation, rate-limiting, CSRF, and publish-lock
  (which assume a single writer via the bridge).

## Consequences

- **New pod resource** `members.ttl` (owner-writable, bridge-read), provisioned in
  `writeRepoMetadata` alongside the existing containers; a small app vocab
  (`solidgit:Member` / `solidgit:role` or equivalent under the existing `mc:`/
  `solidgit:` namespaces — no new external vocab).
- **`requireMember(repo, minRole)`** in `src/lib/auth/session.ts` replaces the
  bare `requireOwner` on collaboration routes; owner-only routes (delete repo,
  manage members) require `admin`.
- **Private-repo reads** add a member `Read` WAC grant (a new helper alongside
  `setPublicReadAcl`/`setInboxAcl` in `src/lib/solid/containers.ts`); public repos
  need no ACL change.
- **Revocation** = remove the member from `members.ttl` (+ drop the private-repo
  Read grant). Immediate, single-write.
- **Accepted v0 scope:** three flat roles, no per-path/branch permissions, no org
  teams, no invitations/accept flow beyond an owner adding a WebID. Membership is
  per-repo (not owner-wide). Real-time co-authoring presence (`collab_enabled`)
  stays orthogonal.
- **Still gated on #142 landing** — #157 reuses that delegated pod-native write
  path; the design is decided but implementation waits on #142 reaching `done`.
