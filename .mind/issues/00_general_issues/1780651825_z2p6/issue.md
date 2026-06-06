---
id: 01JZZ2Z2P0ALICE0OPEN0175
slug: oci-blob-upload-memory-buffer
epic: none
type: refactor
title: "OCI blob uploads buffer whole layer in memory — large layers OOM"
author: "https://alice.example/profile/card#me"
authorKind: human
created: 2026-06-05T09:30Z
milestone: v1.0
afk: true
---

## What's wrong

`docker push` layers buffer entirely in memory (capped by `MAX_PACKAGE_BLOB_BYTES`) before
landing in the pod CAS — no streaming. Very large layers fail or pressure the bridge process.

## Acceptance criteria

- [ ] Stream OCI blob PUTs to a temp file / directly to the CAS instead of buffering, or
- [ ] document the hard cap clearly and reject oversize uploads with a 413 + message.
