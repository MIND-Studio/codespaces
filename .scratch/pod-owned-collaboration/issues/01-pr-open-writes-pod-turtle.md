# Opening a PR writes pod-native Turtle

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/pod-owned-collaboration/PRD.md`

## What to build

The first tracer bullet for pod-native Pull Requests. When a PR is opened on a
Repo, write its canonical Turtle into the owner's Pod under the owner's delegated
Connection, parallel to how Issues are already written.

- Add a `solidgit:PullRequest` vocab term (reusing `sioc:Item` + `sioc:has_creator`/
  `foaf:` the way Issues do), plus a `solidgit:closesIssue` predicate for the
  optional PR→Issue link.
- Introduce the `CollabRdf` rendering core with `renderPull` (Issue/Comment
  rendering is consolidated into it later — see the CollabRdf consolidation issue).
- Add `PodCollabStore.writePull`, mirroring the existing issue writer: ensure the
  `pulls/` container and per-PR container, set the public-read ACL the same way
  `issues/` does, and PUT the Turtle.
- Wire the PR-open path so opening a PR triggers the pod write.

Pod path layout (parallels Issues):

```
{podRoot}/codespaces/{repo}/pulls/                 (container, ACL mirrors issues/)
{podRoot}/codespaces/{repo}/pulls/{n}/             (per-PR container)
{podRoot}/codespaces/{repo}/pulls/{n}/pull.ttl     (canonical PR body)
```

PR Turtle shape (decision from the PRD; render the `open` subset here — `mergeSha`
appears only once merged, in the merge/close issue):

```turtle
<#pull>
    a solidgit:PullRequest, sioc:Item ;
    solidgit:number "N"^^xsd:integer ;
    solidgit:repository <…/codespaces/{repo}/index.ttl#repo> ;
    dcterms:title "…" ;
    sioc:content """…""" ;
    solidgit:status "open" ;
    solidgit:sourceBranch "…" ;
    solidgit:targetBranch "…" ;
    solidgit:sourceSha "…" ;
    solidgit:closesIssue <…/issues/{m}/issue.ttl#issue> ;   # optional
    sioc:has_creator <webid> ;       # may be absent for agent-authored PRs
    dcterms:created "…"^^xsd:dateTime ;
    dcterms:modified "…"^^xsd:dateTime .
```

## Acceptance criteria

- [ ] Opening a PR (human- or Coder-authored) writes `pulls/{n}/pull.ttl` to the
      owner's Pod with the shape above.
- [ ] The `pulls/` container is created idempotently with the same visibility/ACL
      treatment as `issues/`.
- [ ] A PR opened with no author (agent-authored) writes valid Turtle (no broken
      `sioc:has_creator`).
- [ ] A PR that targets an Issue records `solidgit:closesIssue` pointing at the
      issue's pod resource.
- [ ] `CollabRdf.renderPull` has a round-trip-friendly unit test (render produces
      parseable Turtle for the open case, including empty body and embedded `"""`).
- [ ] `PodCollabStore.writePull` is covered by a mock-fetch test asserting the PUT
      target URL and `text/turtle` content type, and that a failing fetch returns
      `ok:false` rather than throwing into the caller.
- [ ] The existing per-PR static Preview feature still works (regression guard).

## Blocked by

None - can start immediately
