---
id: 01JZW0B1Q0ALICE0OPEN0157
slug: membership-access-model
type: feature
title: "Membership & access model for a shared Repo"
author: "https://alice.example/profile/card#me"
authorKind: human
created: 2026-05-31T09:05Z
epic: EPIC_2026-05-31_E002
milestone: prod-cutover         # different milestone than its blocker (v0.9) — scope vs date
afk: false                      # gated: needs-design + blocked
---

## What to build

How a second WebID gains access to a Repo: a membership resource in the pod, the WAC/ACP grants
it implies, and how the bridge reads it to authorize collaboration writes.

## Acceptance criteria

- [ ] Membership record lists WebIDs + roles.
- [ ] Adding a member grants the matching pod ACLs.

## Why it's gated

Blocked on `pr-pod-native-turtle` (0142) — reuses the delegated-write path — and labelled
`needs-design`: the public-vs-member ACL question on 0142 must be answered first. Not for an
agent to pick up yet.
