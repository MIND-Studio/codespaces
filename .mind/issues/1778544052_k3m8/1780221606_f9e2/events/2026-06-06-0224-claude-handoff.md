---
id: 01JZW0A4U0CLAUDE0HAND20142
kind: handoff
actor: "http://localhost:3011/claude/profile/card#me"
actorKind: agent
at: 2026-06-06T0224Z
from: in-progress
to: ready-for-human
prev: 01JZW0A2S0CLAUDE0CLAIM142
---

Implemented #142 for real (the prior "done" handoff described code that wasn't in the repo).
New `src/lib/solid/pulls.ts` mirrors `issues.ts`: `renderPullTurtle` (pure) +
`writePullToPod` (delegated owner fetch, idempotent containers). Wired best-effort into the
PR-open POST route **and** both agent drivers (`coder`, `codex`) so agent-authored PRs mirror
too. ACL is **visibility-based per ADR-0002** (the resolution of this issue's own open
question): public repos → public-read, private → owner-only (`setVisibilityAcl` /
`setOwnerOnlyAcl` added to `containers.ts`); member-read on private is the #157 follow-up.

**Naming note:** the old handoff named `CollabRdf.renderPull` / `PodCollabStore.writePull`,
but the codebase idiom is module functions in `src/lib/solid/` (see `issues.ts`), so this
follows that — `renderPullTurtle` / `writePullToPod`, not invented classes.

Acceptance:
- [x] Opening a PR writes `pulls/{n}/pull.ttl` — wired in `pulls/route.ts` POST + both drivers.
- [x] `pulls/` container created idempotently, ACL applied — `ensurePullContainers`
  (`ensureContainer` + `setVisibilityAcl`, applied once on create like `issues/`).
- [x] Agent-authored PR (no author) writes valid Turtle — renderer omits the
  `sioc:has_creator` triple; pinned by a parser round-trip test.
- [x] `renderPull` round-trip unit test — `tests/pulls-roundtrip.test.ts` parses emitted
  Turtle with n3 (triples + hostile-input injection guard + closesIssue + visibility ACL).
- [x] Per-PR static Preview still works — preview route untouched; full suite green.

Checks: `npx tsc --noEmit` clean; `npm test` 85 passed (was 78, +7). Unblocks #157 once a
human lands this → `done`. Needs a human to review & land — I won't self-close.
