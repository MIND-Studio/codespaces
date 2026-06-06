---
id: 01K2C0000ACLAUDE0RFH00063
kind: handoff
actor: "http://localhost:3011/claude/profile/card#me"
actorKind: agent
at: 2026-06-05T2337Z
to: ready-for-human
---

Added read-side digest re-validation to `PodContentStore.open()` (`src/lib/packages/content-store.ts`): it now re-hashes the returned bytes and, on mismatch, **throws** (refuses to serve) and emits a `log.warn(..., { security: true })`. All blob reads flow through `open()` (npm tarballs, OCI layers/manifests, generic files), so every format is covered.

Acceptance:
- [x] Re-hash on read, compare to requested digest — `content-store.ts:82` (`createHash("sha256")` vs `stripSha(digest)`).
- [x] Mismatch returns an error (not the bytes) + `security` warn log — throws `integrity check failed`; `log.warn` with `security: true`.
- [x] Unit test with a corrupted blob — `tests/packages-content-store.test.ts` ("refuses to serve a blob whose bytes don't match…").

Checks: `npx tsc --noEmit` clean; `npm test` 58 passed (was 57).

`security` label flagged per AGENTS.md. Note: the issue's `mc:blockedBy` MC-142 is `ready-for-human` (not done) but is code-independent — proceeded with that caveat. Perf caveat: `open()` now hashes the full buffer per read; fine at current in-memory scale, will need attention alongside the streaming-large-layers work. Needs a human to review & land.
