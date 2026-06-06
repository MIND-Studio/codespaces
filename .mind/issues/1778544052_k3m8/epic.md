---
id: pod-owned-collaboration
title: "Pod-owned collaboration record"
status: active
created: 2026-05-12
---

# Goal

Complete the pod-owned collaboration record so the **entire** history — Issues, Comments,
**and Pull Requests** — lives in the owner's pod as canonical Turtle, the Registry becomes a
rebuildable projection of that pod truth, and pod writes are durable rather than best-effort.

This makes "your pod is your platform" survive a bridge migration, a lost disk, an expired
connection, and a wiped index.

> The issues under this epic are the implementation breakdown. Most target milestone `v0.9`;
> the original PR-previews tracer (`2026-05-12-pr-static-previews`) already shipped under `v0.8`.
