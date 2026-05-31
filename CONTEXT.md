# Mind Codespaces

A Solid-pod-native take on GitHub: you `git push` a repository to a bridge, which
keeps the bare repo and publishes the built site into your own Solid Pod. Identity,
repo metadata, issues, and the published site all live in the pod (pull requests are
still registry-only in v0); the bridge is replaceable glue. This is one app in the wider
[Mind protocol](https://mind-studio.github.io/mind-specification/); terms below are
canonical at the protocol level, with a `_v0 status_` note where this prototype
(`mind-codespaces-v0`) deliberately diverges from the spec.

## Language

### Mind protocol roles

**Pod**:
A user's Solid storage. The source of truth for everything durable and shareable —
identity, repo metadata, issues, and the published site. (PRs are registry-only in v0.)
_Avoid_: storage, account, drive

**Worker** (Mind protocol):
A long-running, headless background process that reads and writes a user's pod on
their behalf. Three subtypes in the spec: indexer (cache), bridge (protocol
translator), agent runtime (hosts AI agents).
_Avoid_: service, daemon, backend

**Bridge**:
A worker of the bridge subtype: translates git ↔ pod. Accepts git pushes, stores the
bare repo, and publishes the built site into the owner's pod. Replaceable glue — not
the source of truth for code or site.
_Avoid_: server, backend, app
_v0 status_: acts as the delegated owner (not its own WebID + `hand.ttl` scope); bare
repos live on bridge disk, not in the pod.

**Agent runtime** (Mind protocol):
The worker subtype that hosts Agents — loads their declarations, fires them on
triggers, keeps per-agent memory and audit. The only autonomous worker type (indexers
cache, bridges translate, agent runtimes decide).
_Avoid_: agent host, orchestrator
_v0 status_: the bridge embeds a minimal agent runtime (the "agents" subsystem) — fires
Roles on issue events only, with no pod-side roster/memory/audit yet. So the bridge
plays two worker roles at once (bridge + agent runtime), fused into one process.

**App** (Mind protocol):
A UI-first, foreground program that runs in the user's own session and stops when
closed. Distinct from a worker by temporality (foreground vs background) and autonomy
(your session vs its own credentials).
_Avoid_: frontend, client
_v0 status_: the dashboard UI and the bridge worker are fused into one Next.js process
here, rather than split into a separate app + worker.

### Identity & ownership

**WebID**:
A user's portable Solid identity URI (e.g. `https://pod.example/alice/profile/card#me`).
The global identifier for a person or agent (`foaf:Agent`).
_Avoid_: user id, account id, DID

**Owner**:
The namespace a repo belongs to — the slug in `/repos/{owner}/{name}`. May be a person
or an org (e.g. `mind`). Identified by a WebID + pod root.
_Avoid_: account, user, namespace

**User**:
A registered account that signed up through the bridge (WebID + pod root + email). Owns
repos under its owner-slug. Not every owner string is backed by a User yet.
_Avoid_: owner, account, member

**Connection** (connected pod):
A WebID the bridge has been authorized to act as, via a stored delegated OIDC session
(encrypted refresh token). Created at `/connect`, managed/revoked at `/identities`.
_Avoid_: identity, login, session, credential
_Note_: the SQLite table and the route are named `identities` for legacy reasons; the
concept is a Connection.

### Repositories

**Repo**:
A logical project owned by an Owner — code, metadata, issues, PRs, and (if Pages is on)
a published site. Manifested in three places: a bare repo, a registry row, and pod
metadata.
_Avoid_: project, repository (long form)

**Bare repo**:
The git objects and refs for a Repo, stored on the bridge's disk (`GIT_DATA_DIR`).
Source of truth for code and history.
_Avoid_: clone, working copy, checkout
_v0 status_: lives on bridge disk; the spec wants git objects pod-resident.

**Registry**:
The bridge's SQLite bookkeeping (repos, push tokens, runs, the issue/PR index).
Operational state, never the source of truth — rebuildable from disk + pod.
_Avoid_: database, db, store

**Repo metadata**:
The pod-side Turtle description of a Repo (`solidgit:Repository`). The portable,
pod-owned record of the Repo's existence and settings.
_Avoid_: repo config, manifest

**Push token**:
A per-repo HTTP-Basic credential for `git push` (always required) and `git clone`
(when the Repo is private). Stored as a sha256 hash; the plaintext is shown once at
creation.
_Avoid_: password, API key, access token

### Publishing

**Pages**:
The world-readable static site published from a Repo into the owner's pod, and the
feature that produces it. Static only. ("Mind Pages" is the marketing name.)
_Avoid_: site, website, deploy, Mind Pages (in code/prose)

**Publish**:
The act of writing a Repo's static artifact into its pod target container — either
copied directly from a branch path, or taken from a Workflow's build output.
_Avoid_: deploy, ship, upload

**Publisher**:
The bridge component that performs a Publish — writes the artifact into the pod target
container under the owner's delegated session.
_Avoid_: deployer, uploader

**Reconciler**:
The background loop that reconciles a Repo's git HEAD against its `last_published_sha`
and re-publishes on divergence (covers a missed post-receive hook).
_Avoid_: sync, cron, watcher

### Collaboration

**Issue**:
A pod-native ticket on a Repo, stored canonically as Turtle in the owner's pod
(`{podRoot}/codespaces/{repo}/issues/{n}/issue.ttl`). Numbered per-repo. The SQLite
row is only an index. Filed by a WebID (`foaf:Agent`).
_Avoid_: ticket, task, bug (as the type)

**Comment**:
A pod-native reply on an Issue, stored as sibling Turtle. Authored by a human or by
the coder agent (a coder Comment carries its originating agent run).
_Avoid_: reply, note, message

**Pull Request (PR)**:
A proposal to merge a source branch into a target branch within a Repo. Numbered
per-repo, independent of Issues.
_Avoid_: merge request, change, patch
_v0 status_: registry-only; not yet pod-native (unlike Issues). Follow-up to move into
the pod.

**Preview**:
A per-PR static build published into a pod preview container, so a PR's result is
viewable before merge. SHA-guarded against rebuilding an unchanged branch.
_Avoid_: staging, deploy preview

### Automation

**Workflow**:
A build pipeline declared in a Repo's `.mind/workflow.yml` (`run:` commands, optional
`publish:` dir, `timeout:`). Picked up on push.
_Avoid_: pipeline, CI, action, build script

**Workflow run**:
One execution of a Workflow (`queued → running → success | failed | error`), with a
log tail.
_Avoid_: build, job, CI run

**Runner**:
The executor of a Workflow's commands — `docker` (ephemeral sandbox container) or
`native` (host `sh -c`), auto-detected.
_Avoid_: executor (reserve for Agents), sandbox

**Agent**:
A cognitive worker (Mind protocol) that fills a Role — decides per turn what to do, vs
an indexer (caches) or bridge (translates). Hosted by an agent runtime.
_Avoid_: bot, assistant; never use "agent" for a `foaf:Agent` issue author (use WebID)

**Role**:
A named function an Agent performs, registered as a first-class responder with triggers
and a default Driver. v0: `coder` (live); `reviewer`, `engineer` planned.
_Avoid_: persona, job

**Coder**:
The v0 Agent/Role. Fires on `issue.created` + `issue.commented`; each turn decides to
**implement** (commit to `agent/issue-{n}`, open a draft PR) or **ask** (post an issue
Comment). Runs `opencode` in a sandbox.
_Avoid_: engineer (the code uses "coder")

**Driver**:
The pluggable backend that runs one turn of a Role — `echo` / `openrouter` / `coder` /
`codex`. Maps to the Mind spec's "executor."
_Avoid_: backend, model, engine
_Note_: the `coder` Driver runs the Coder Role's turns; the two names coincide but name
different things (a backend vs a Role).

**Agent run**:
One firing of a Role via a Driver for one event. Recorded in `agent_runs`.
_Avoid_: job, task, invocation
