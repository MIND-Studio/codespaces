---
id: 01JZ4AB00A0ALICE0OPEN0128
slug: pr-static-previews
type: feature
title: "Publish per-PR static previews to the pod"
author: "https://alice.example/profile/card#me"
authorKind: human
created: 2026-05-12T11:00Z
epic: EPIC_2026-05-12_E001
milestone: v0.8
# Folds to `done`. Note it stays in epic 01 — state isn't the path, so a done issue
# does NOT move to a done/ folder. Its events say done; the build groups it accordingly.
---

## What to build

On PR open, build the consumer repo's static export and publish it to the owner's pod under
a per-PR preview path; surface the URL on the PR. Build-aware via `.mind/workflow.yml`.

## Acceptance criteria

- [x] PR open publishes a static preview to the pod.
- [x] Preview URL surfaced on the PR card.
- [x] Cleaned up on merge/close.
