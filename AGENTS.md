# Orientation

The user-facing README is the source of truth for commands, endpoints, ports, env vars, demo user, and layout — imported below. `docs/IDEA.md` has the design rationale; `docs/CHANGELOG.md` is what actually shipped (the README occasionally lags).

@README.md

# Agent-only notes (not in README)

- A parent-folder `CLAUDE.md` may describe a *different* project (Mind Cube — a Raspberry Pi AI assistant). Ignore it here.
- **`npm test` runs vitest** (path-traversal, push-tokens, publisher walk, quotas, the four `packages-*` suites, and the two `inbox-*` suites — 57 tests as of the proposals/LDN-inbox change). `npm run smoke:db` applies registry migrations against a throwaway DB; `npx tsc --noEmit` type-checks. Integration tests (live-CSS publish, Smart-HTTP round-trip, OIDC) are still backlog — see PRODUCTION-READINESS §3.2.
- The README's command list omits a few `tsx` scripts: `seed:profiles`, `seed:workflows`, `import:repo`, `smoke:db`. See `scripts/` and `package.json`.
- Wiping `.css-data/` invalidates every OIDC dynamic-client registration; bridge identity rows in SQLite go stale and you must re-authorize via `/connect`. **This also blocks package/Pages writes:** the write path (`getOwnerFetch`) never falls back to seeded creds once a *stale* delegated identity exists, even in dev — re-`/connect`, or delete the identity (`DELETE /api/identities/{webId}`) and set `ALLOW_SEEDED_FALLBACK=1` (dev-only).
- `.git-data/repos/{owner}/{name}.git/hooks/post-receive` bakes `BRIDGE_PUBLIC_URL` at *creation* time. Changing the env var later means re-creating the repo or `sed`-ing the hook file.

## Mind Packages (`src/lib/packages/`, the `/v2/` OCI mount)

- Three formats (`npm`/`oci`/`file`) share one content-addressed `PodContentStore`; bytes go to `{podRoot}/public/packages/blobs/sha256/…`, the SQLite index (`015_packages.sql`) maps `(repo,type,name,version)` → digest. Auth reuses repo **push tokens**. Design rationale: `docs/adr/0001-mind-packages-in-the-bridge.md`.
- **`/v2/` needs `skipTrailingSlashRedirect: true`** (`next.config.ts`): docker's version ping is `GET /v2/` *with* the slash, and a 308 → `/v2` reads as "not a v2 registry". Don't remove it.
- **`docker login` over plain `localhost` does NOT work on Docker Desktop** (daemon-in-VM forces HTTPS). For a real CLI round-trip use `crane`/`skopeo` with `--insecure` against `host.docker.internal:3010`, or add `insecure-registries`. The wire protocol itself is fine.
- OCI blob uploads buffer **in memory** (capped by `MAX_PACKAGE_BLOB_BYTES`) — no streaming yet. Oversize blobs are rejected with a `413` *before* the body is buffered (declared `Content-Length` guard in the `/v2` route, plus the cumulative-size check in `oci-uploads.ts`), so a huge layer 413s instead of OOMing the bridge; genuinely large layers still need the streaming follow-up. Manifests are indexed by tag *and* digest; raw layers/configs live in the CAS only.
- The CSRF header for mutating `/api/*` routes is `X-CSRF-Token` (cookie `mc-csrf`); `/api/auth/login` also requires an `Origin` (or `Sec-Fetch-Site`) same-origin signal.

## Issue proposals — the LDN inbox (`src/lib/solid/inbox.ts`)

- `POST /api/repos/{o}/{r}/issues/propose` is the **one intentionally-unauthenticated mutating route** — anyone (incl. logged-out) can propose an issue. It deliberately does NOT run the CSRF/`requireOwner` guards; abuse control is the `proposalCreate` per-IP rate limit + title/body size caps + the per-repo `proposals_enabled` flag (migration `016`) + owner dismissal. Don't "fix" it by adding `requireOwner`.
- Proposals are LDN notifications (`as:Announce`) in a pod-native `ldp:inbox` at `{podRoot}/codespaces/{repo}/inbox/`, provisioned (container + append-only `.acl`) inside `writeRepoMetadata`. The inbox is owner-read / public-write: `setInboxAcl` gives the owner `Read/Write/Control` and, only under `INBOX_PUBLIC_APPEND=1`, `foaf:Agent acl:Append` (never read, never `acl:default`).
- **Writes are bridge-mediated with the owner's delegated fetch** (`getOwnerFetch`), so an anonymous proposal still needs the owner to have a live `/connect` identity (or dev seeded fallback) — the inbox ACL stays owner-only-writable by default. The repo advertises `ldp:inbox` on `<#repo>` for discovery.
- Accept (`POST .../inbox/{id}/accept`, owner-only) mints a normal `.mind` issue at `todo` via `createMindIssue` (author = owner, proposer recorded as provenance **in the body** — the tracker fold carries no per-issue labels, so don't expect a `proposal` label on the board) and then **deletes** the inbox resource. Dismiss (`DELETE .../inbox/{id}`) just deletes it. The owner takes it from `todo` as usual.
- The propose→accept→git-push flow and live-CSS inbox I/O are integration-only (need a pod + a real bare repo). The offline unit tests (`tests/inbox-acl.test.ts`, `tests/inbox-roundtrip.test.ts`) cover the ACL shape and a serialize→list→delete round-trip by mocking `getOwnerFetch` with an in-memory pod.

## Pod-native tracker mirror (`src/lib/solid/tracker-pod.ts`, MC-160)

- The repo's `.mind`-derived `flow:Tracker` is mirrored into the owner's pod at `{podRoot}/codespaces/{repo}/.mind/{tracker,epics,state}.ttl` — **multi-doc, public-read** (same ACL shape as `issues/`), so mind-issues and the SolidOS issue-pane can render the same tracker by URL. `.mind/` stays the authoring layer; the pod copy is the canonical render source.
- The mirror fires from the **post-receive hook** on any push to the default branch (a consumer's `tracker:build`, or a bridge-authored `createMindIssue`, whose own push also lands there). It's **fire-and-forget + fail-soft** (`mirrorTrackerFromGit` reads the committed `.mind/build/*.ttl` blobs and `publishTrackerToPod`s them) — a pod hiccup never blocks the git push.
- The dashboard reads via `readRepoTracker` (`src/lib/tracker/source.ts`): **pod-first** (`readPodTracker`), **git-blob fallback** (`readGitTracker`). Used by both the Issues board and the repo-tabs count, so they stay consistent. A repo not yet mirrored, or a pod outage, degrades to the last-pushed git snapshot.
- The Registry `issues` index is a **projection** of the pod tracker (`projectTrackerToRegistry`, `src/lib/registry/issue-projection.ts`): upsert by stable `(repo_id, number)`, idempotent, leaves legacy flat `issue.ttl` rows untouched. No new migration — reuses the `004_issues` table.
- Live-CSS mirror/read + the propose-style git round-trip are integration-only. Offline unit tests: `tests/tracker-pod.test.ts` (publish + ACL + idempotency + `flow:Tracker` shape + read-back, in-memory pod) and `tests/issue-projection.test.ts` (projection by number, idempotent, flat coexistence). **Don't anchor `tests/tracker-parse.test.ts` open/closed/assignee assertions on the live board** — claiming/handing-off (and eventually closing *every* issue to Done) mutates `state.ttl`; that test now asserts the `wf:assignee` join *and* the open-vs-closed partition against fixed inline trios, and checks only board-stable structural joins (epic membership, `blocks`, `afk`) against the live `.mind/build`.

## Membership — bridge-enforced capability (`src/lib/solid/members.ts`, MC-157, ADR-0002)

- Repo membership is a **pod-native roster** at `{podRoot}/codespaces/{repo}/members.ttl` mapping WebID → `reader|writer|admin`, owner-writable, **bridge-read via the owner's delegated fetch**. `requireMember(repo, minRole)` (`src/lib/auth/session.ts`) is the enforcement primitive: the owner is an implicit `admin` (short-circuits, no pod read); anyone else is looked up in the roster. Pass the **registry** `Repo`, never request-body fields — the auth target must not be attacker-controlled.
- A member's only pod-level privilege on a **private** repo is `acl:Read` (on `pulls/` + the roster doc, via `setMemberReadAcl`/`setVisibilityAcl` in `containers.ts`). **The bridge stays the sole WAC writer** (P0-R2) — a member never gets direct write to the owner's pod; mutations go through `getOwnerFetch`. Public repos are unchanged (already public-read).
- **Additive, not yet wired:** the ~30 existing `requireOwner` collab routes are **not** migrated to `requireMember` yet (deliberate per-route auth-surface change). New routes: `GET/POST /api/repos/{o}/{r}/members` (reader-read, admin-write; owner can't be added as a member), `DELETE …/members/{webid}`. Offline test: `tests/members-roundtrip.test.ts` (render/hostile-drop/dedup/add/role-update/private-grant/public-no-op/remove/resolve, in-memory pod). Live-CSS member-read enforcement is integration-backlog.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# This is NOT the Solid setup you assume

This app uses a Solid stack (Community Solid Server v7 via Docker). Before changing anything Solid-related, skim `src/lib/solid/` here.

# Turbopack CSS hot-reload is unreliable

If a CSS change isn't visible — even after restarting the dev server — the cached bundle in `.next/` is stale. `rm -rf .next && npm run dev` forces a fresh compile (or just `npm run dev:clean`, which wipes `.next` before starting). Verified once: a new `.markdown-body ul { list-style-type: disc; }` rule kept being absent from the served bundle until the cache was wiped.

# Workflow runner auto-detects Docker

`runWorkflow` probes `docker info` once at first use. If Docker is reachable, every workflow's `run:` commands execute inside a single `node:22-alpine` container (`--rm --user $(uid):$(gid) --memory=2g --cpus=2`, bind-mount the temp checkout at `/work`). Otherwise it falls back to native `sh -c` on the host with no sandbox. The chosen mode is logged at the top of every run's log (`[runner: docker]` / `[runner: native]`). Force one with `MIND_RUNNER=docker` or `MIND_RUNNER=native`. The Docker path needs `node:22-alpine` pulled (~150MB); the first cold run pays the pull cost. The publish step runs back on the host *after* the container exits — that's why the container runs as the host UID, so file ownership in the bind mount doesn't trip up the publisher. See `docs/WORKFLOWS-PLAN.md` for the threat-model boundary (step 2a sandboxes from the host fs, not from the network).

## Agent skills

### Issue tracker

Issues and PRDs live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, used verbatim. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Commits & releases

Use [Conventional Commits](https://www.conventionalcommits.org) on `main`
(`fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major). Releases,
tags, and `CHANGELOG.md` are automated by **release-please** — never tag manually
or hand-edit `CHANGELOG.md`. To cut a release, merge the open
"chore(main): release X.Y.Z" PR. See the README's Releases section.
