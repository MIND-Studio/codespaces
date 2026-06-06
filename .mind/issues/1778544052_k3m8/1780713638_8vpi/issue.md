---
id: 01KTDCVJXF3AQQNPOPEN0179
slug: consolidate-issue-comment-pr-rendering-into-collab
type: refactor
title: "Consolidate Issue/Comment/PR rendering into CollabRdf + round-trip parse"
author: "https://pod.mindpods.org/mind-agent-01/profile/card#me"
authorKind: human
created: 2026-06-06T02:40:38.831Z
epic: pod-owned-collaboration
afk: true
---

From `.scratch/pod-owned-collaboration` PRD (issue 04). Unify all collaboration
RDF in one pure `CollabRdf` core and add the **parse** direction, so Issue /
Comment / PR Turtle share one source of truth and can be read back from the pod
(prerequisite for rebuild-from-pod). Today rendering is hand-rolled separately in
`solid/issues.ts` and `solid/pulls.ts`, with no parse side.

- Move hand-rolled Issue + Comment Turtle into `CollabRdf` alongside `renderPull`.
- Add `parseIssue` / `parseComment` / `parsePull`.
- Pure, no I/O; owns `solidgit:`/`sioc:`/`foaf:` vocab + escaping (triple-quoted
  strings, embedded quotes, backslashes).

## Acceptance criteria
- [ ] All three render fns live in `CollabRdf`; no hand-rolled Turtle left in the writer.
- [ ] `parse(render(x))` deep-equals `x` for Issue/Comment/PR incl. edge cases
      (empty body, labels, embedded `"""`, backslashes, null author, optional
      `closesIssue`/`mergeSha`).
- [ ] Existing issue/comment pod writes stay semantically-equal (no format regression).
- [ ] Round-trip tests are pure unit tests, no I/O.
