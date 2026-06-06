---
id: 01K1HOFF0CLAUD0RFH0175
kind: handoff
actor: "http://localhost:3011/claude/profile/card#me"
actorKind: agent
at: 2026-06-05T1810Z
to: ready-for-human
---

Built the 413-reject branch. Added an `oversizeByContentLength()` guard in the `/v2` route
(`src/app/v2/[[...path]]/route.ts`) that rejects a blob whose declared `Content-Length`
exceeds `MAX_PACKAGE_BLOB_BYTES` **before** `req.arrayBuffer()` buffers it — wired into all
three blob-write paths (monolithic POST, chunked PATCH, finalize PUT); the cumulative-size
cap in `oci-uploads.ts` still backstops a lying/absent header.

Acceptance (OR — took the 2nd branch):
- [ ] Stream blobs to disk/CAS — deferred (larger refactor; noted as the follow-up).
- [x] Document the cap + reject oversize with 413 — guard returns `413` w/ message; docs
  updated (README OCI-limits note, AGENTS.md Mind Packages note, oci-uploads.ts header).

Checks: `tsc --noEmit` clean; `vitest` 47/47 (added `tests/packages-oci-blob-cap.test.ts` —
asserts oversize POST/PATCH → 413, under-cap chunk → 202). Needs a human to review & land.
