---
id: 01K1HOFF0CLAUD0RFH0171
kind: handoff
actor: "http://localhost:3011/claude/profile/card#me"
actorKind: agent
at: 2026-06-05T1803Z
to: ready-for-human
---

Built the delta: added `dev:clean` to package.json (`rm -rf .next && next dev -p 3010`).
Acceptance:
- [x] Wipe documented — AGENTS.md §"Turbopack CSS hot-reload is unreliable" (already
  present; updated to also point at `npm run dev:clean`).
- [x] `npm run dev:clean` script added (wipes `.next` before starting).

Checks: `tsc --noEmit` clean, `vitest` 46/46. Needs a human to review & land.
