# Consolidate Issue/Comment/PR rendering into CollabRdf + round-trip parse

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/pod-owned-collaboration/PRD.md`

## What to build

Unify all collaboration-artifact RDF in one pure `CollabRdf` core and add the
parse direction, so the Issue, Comment, and PR Turtle shapes share a single source
of truth and can be read back from the Pod. Parse is the prerequisite for
rebuilding the index from the Pod.

- Move the existing hand-rolled Issue and Comment Turtle rendering into `CollabRdf`
  alongside `renderPull`.
- Add `parseIssue`, `parseComment`, `parsePull` so a pod Turtle resource maps back
  to its domain object.
- `CollabRdf` performs no I/O — it is pure render/parse over the `solidgit:`/
  `sioc:`/`foaf:` vocab and handles escaping (triple-quoted long strings, embedded
  quotes, backslashes).

## Acceptance criteria

- [ ] Issue, Comment, and PR rendering all live in `CollabRdf`; no hand-rolled
      Turtle remains in the Solid writer.
- [ ] `parse(render(x))` deep-equals `x` for Issue, Comment, and PR, including
      edge cases: empty body, labels, embedded `"""`, backslashes, null author,
      optional `closesIssue`/`mergeSha`.
- [ ] Existing issue/comment pod writes produce byte-compatible (or
      semantically-equal) Turtle to before the refactor (no pod-format regression).
- [ ] Round-trip tests run as pure unit tests with no I/O.

## Blocked by

- #01 — Opening a PR writes pod-native Turtle (introduces `CollabRdf` with `renderPull`)
