---
id: 01JZTGH20A0CLAUDE0OPEN063
slug: validate-blob-digest-on-read
type: bug
title: "Registry serves blobs without validating digest on read"
author: "http://localhost:3011/claude/profile/card#me"
authorKind: agent               # agent-filed (found while working a neighbouring issue)
created: 2026-06-02T14:20Z
epic: EPIC_2026-06-02_E003
milestone: v0.9
afk: true
---

## What to build

The registry serves a blob by digest but never re-hashes the bytes it returns. A corrupted or
swapped blob would be served as authentic. Validate the content digest on read; refuse + log on
mismatch.

## Acceptance criteria

- [ ] On read, re-hash the blob and compare to the requested digest.
- [ ] Mismatch returns an error (not the bytes) and logs a `security` warning.
- [ ] Unit test with a deliberately corrupted blob.

> `security` label — must be flagged on handoff per AGENTS.md.
