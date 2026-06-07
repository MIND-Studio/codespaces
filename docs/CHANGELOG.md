> **Historical / manual log.** Since 2026-06-07, releases are automated by
> [release-please](https://github.com/googleapis/release-please) and the canonical
> changelog is the auto-generated root [`CHANGELOG.md`](../CHANGELOG.md). This file
> is kept for pre-automation history and design notes — don't add new release
> entries here.

# Changelog

What shipped in each iteration. Most-recent at the top.

## v0.10 — Membership capability, pod-mirrored tracker, refresh-token hardening (2026-06-06)

Closes the pod-owned-collaboration epic's first wave: the Pages publish path now
mints a usable refresh token, repos carry a pod-native member roster, and the
`.mind` tracker is mirrored into the pod as the canonical render source. Shipped
to `codespaces.mindpods.org` as `v0.1.21`.

### Pages publish: refresh-token fix (MC-176)

- **Newly-connected / scripted identities couldn't publish Pages** —
  `…/public/sites/<repo>/` 404'd with "refresh token failed". Root cause: the
  bridge's scripted CSS consent POST (`src/lib/solid/css-account.ts`) didn't ask
  CSS to **remember** the grant, and CSS v7 only issues a refresh token for a
  remembered consent. Fix: `body: { remember: true }`. `startAuthFlow` already
  requests `offline_access` (SDK default), so the remembered consent was the
  missing piece. Verified against pods.mindpods.org (`{}` → no refresh token;
  `{ remember: true }` → a 43-char refresh token stored, publishes refresh
  cleanly).

### Repo membership — a bridge-enforced capability (MC-157, ADR-0002)

- **Pod-native `members.ttl` roster** (`src/lib/solid/members.ts`) records
  WebID → `reader|writer|admin` in the owner's pod, owner-writable, bridge-read
  via the owner's delegated fetch. `requireMember(repo, minRole)` is the
  enforcement primitive (owner = implicit admin, no pod read). Private repos
  grant each member `acl:Read` on `pulls/` + the roster doc; the owner stays
  **sole writer** (P0-R2 — a member never gets direct WAC write). New
  `GET/POST /api/repos/{o}/{r}/members`, `DELETE …/members/{webid}`;
  `solidgit:members` advertised on `<#repo>`. Tests: `members-roundtrip.test.ts`
  (9). Deliberately **additive** — the ~30 existing `requireOwner` collab routes
  are not yet migrated to `requireMember` (a Settings → Members UI + the route
  migration are the epic's next steps).

### `.mind` tracker mirrored into the pod (MC-160)

- The repo's `flow:Tracker` is mirrored to
  `{pod}/codespaces/{repo}/.mind/{tracker,epics,state}.ttl` (multi-doc,
  public-read) from the **post-receive hook** — fire-and-forget + fail-soft, so
  a pod hiccup never blocks the push (`src/lib/solid/tracker-pod.ts`). The
  dashboard reads **pod-first with a git-blob fallback**
  (`src/lib/tracker/source.ts`), and the Registry `issues` index is a
  **projection** of the pod tracker (`src/lib/registry/issue-projection.ts`,
  reuses `004_issues`). Tests: `tracker-pod.test.ts`, `issue-projection.test.ts`.

### Auth / identity hardening (MC-150, MC-173)

- **Identities survive a bridge restart** — per-session DPoP keypair + refresh
  token persist AES-256-GCM in SQLite, rehydrated from storage on boot, killing
  the re-connect loop (`tests/identity-storage-restart.test.ts`).
- **A dead delegated registration is surfaced, not silent** — the SDK's
  `invalid_client` / not-logged-in throws normalise to `OidcRefreshFailedError`
  → `OwnerFetchUnavailableError("needs-reauthorization")` pointing at `/connect`,
  and (per P0-R2) never falls back to seeded creds when a stale delegated
  identity exists (`tests/oidc-refresh-normalize.test.ts`,
  `tests/fetch-for-owner.test.ts`).

`tsc` clean, 94 unit tests pass (24 files). Live-CSS round-trips (fresh-connect
publish, member-read enforcement, pod mirror/read) remain the
PRODUCTION-READINESS §3.2 integration backlog.

## v0.9 — Public proposals (LDN inbox), live co-authoring, `.mind` tracker, theming (2026-06-05)

A collaboration-and-intake iteration: outsiders can now propose work, drafts are
co-written in real time, the Issues board reads a pod-native `.mind` tracker, and
the whole surface picks up a light/dark/neo theme.

### Public issue proposals — a pod-native LDN inbox

- **Anyone (incl. logged-out) can _propose_ an issue.** `POST
  /api/repos/{o}/{r}/issues/propose` is intentionally unauthenticated (no
  `requireOwner`, no CSRF); abuse control is a `proposalCreate` per-IP rate-limit
  bucket + title/body size caps + a per-repo `proposals_enabled` flag (migration
  `016_proposals.sql`) + owner dismissal.
- **Proposals are [Linked Data Notifications](https://www.w3.org/TR/ldn/)**
  (`as:Announce`) dropped into a pod-native `ldp:inbox` at
  `{podRoot}/codespaces/{repo}/inbox/` — `src/lib/solid/inbox.ts`. The inbox is
  owner-read / public-write: `setInboxAcl` (`containers.ts`) gives the owner
  `Read/Write/Control` and, only under `INBOX_PUBLIC_APPEND=1`, `foaf:Agent
  acl:Append` (never read, never `acl:default`). Writes are bridge-mediated with
  the owner's delegated fetch; the repo advertises `ldp:inbox` on `<#repo>` for
  discovery. New `as:`/`ldp:` namespaces + `solidgit:IssueProposal` in `vocab.ts`.
- **Owner surface** — `/repos/{o}/{r}/proposals` (owner-only tab, no count badge
  by design — the count is a pod round-trip) lists the inbox. **Accept**
  (`POST .../inbox/{id}/accept`) mints a `needs-triage` `.mind` issue (proposer
  recorded as provenance in the body) then deletes the notification; **Dismiss**
  (`DELETE .../inbox/{id}`) just deletes it. Public propose form at
  `/repos/{o}/{r}/issues/propose`.
- Tests: `inbox-acl.test.ts` (ACL shape) + `inbox-roundtrip.test.ts`
  (serialize → list → delete + hostile-Turtle injection) against an in-memory pod.

### Live co-authoring on issue/epic drafts

- **Real-time multiplayer drafts** — `/repos/{o}/{r}/issues/draft/{id}` is a Yjs
  room: several people co-write one draft with live cursors via a y-websocket
  relay (`relay/server.ts`, `npm run relay`, :3012 — no persistence, no pod
  creds). TipTap editor (`@tiptap/*`, `tiptap-markdown`) with the Collaboration
  extension; `src/lib/collab/` (`draft-doc.ts`, `config.ts`). Per-repo
  `collab_enabled` flag (migration `017_collab.sql`); off → local-only (IndexedDB,
  no relay).
- **Issue-vs-epic hint** — `suggest-kind.ts` reads the draft markdown and
  pre-sets the Kind toggle (keyword/structure heuristic); `suggest-kind.test.ts`.

### `.mind` git tracker (the Issues board's read model)

- **Pod-native `.mind` tracker** — `src/lib/tracker/` (`parse`/`read`/`build`/
  `author`/`model`) folds append-only event Markdown into board state.
  `scripts/tracker-build.ts` (`tracker:build` / `tracker:check`) + a calendar fold
  (`calendar-build.ts`). New `mind-issues` / `mind-epics` API routes and an epic
  draft flow. Tests: `tracker-parse.test.ts`, `create-epic.test.ts`. N3 types in
  `src/types/n3.d.ts`.

### Theming + misc

- **Light / dark / neo themes** — `src/components/theme-shell.tsx` +
  `theme-toggle.tsx`, `src/lib/theme/neo.ts`, applied across `layout.tsx`,
  `globals.css`, `main-nav.tsx` and the repo/profile/issue surfaces. (Supersedes
  the v0.6 note that `theme-toggle.tsx` was removed — it's back as the user-facing
  toggle.)
- **Packages** — OCI blob uploads now reject oversize layers up front by declared
  `Content-Length` and cumulative chunk size (`oci-uploads.ts` +
  `packages-oci-blob-cap.test.ts`); empty-state "push tokens" link now points to
  Settings → tokens instead of the code browser.

`tsc` clean, 57 unit tests pass (16 files), `smoke:db` 9/9 (migrations 016/017).
Integration coverage (live-CSS propose→accept→git-push, relay round-trip) remains
the PRODUCTION-READINESS §3.2 backlog.

## v0.8.1 — Mind Packages: web UI, `/v2` version-ping fix, live verification (2026-06-01)

The packages feature was API/CLI-only; this adds the dashboard surface and
fixes the one bug that blocked real OCI clients.

- **Packages tab + page** — `src/app/repos/[owner]/[repo]/packages/page.tsx` and a
  new tab in `repo-tabs.tsx` (distinct `(type, name)` count, so an OCI image
  indexed by both tag and digest counts once). Groups published artifacts into
  **npm / container images / files**, each with version, size, relative time,
  short digest, and a copy-able install hint (`npm install` / `docker pull` /
  `curl`). Empty state and a private-repo locked state (owner-gated). Added
  `formatBytes` to `src/lib/format.ts`.
- **`/v2/` version-ping fix** — `skipTrailingSlashRedirect: true` in
  `next.config.ts`. Next was 308-redirecting `GET /v2/` → `/v2`; docker/OCI
  clients treat anything but 200/401 on the trailing-slash ping as "not a v2
  registry", so the redirect broke `docker login`/push. Now `/v2/` answers 200
  directly. (Both slash variants still resolve for every other route.)
- **Verified live against local CSS** — all three formats round-tripped with
  bytes confirmed in the pod CAS: generic file (curl PUT/GET), npm (`npm publish`
  → `npm install` → `require()`), OCI (the full Distribution v2 wire sequence +
  a real `crane push`/`pull`/`export` round-trip over plain HTTP). The
  workflows→publish chain was re-confirmed too (build in a `node:22-alpine`
  container → publish to pod → live site, with failure-gating: a broken build
  leaves the previous site intact).
- **Doc fixes** — README CLI flow now sends `Origin` on login and the correct
  `X-CSRF-Token` header (was `x-mc-csrf`); documented the Docker-Desktop
  plain-HTTP / `insecure-registries` caveat and the `crane --insecure`
  alternative. Added a Packages glossary section to `CONTEXT.md` and an ADR
  (`docs/adr/0001-mind-packages-in-the-bridge.md`).

No new runtime deps; `tsc` clean, 32 unit tests pass, `next build` green.

## v0.8 — Mind Packages: OCI / Docker registry (`docker push`/`pull`) (2026-06-01)

The third package format, on the same pod-backed content-addressed store. A
top-level `/v2/` mount implements the OCI Distribution Spec subset for
`docker push` / `docker pull`.

- **`src/app/v2/[[...path]]/route.ts`** — `GET /v2/` version check; blob upload
  `POST` (start or monolithic single-POST) / `PATCH` (chunk) / `PUT` (finalize);
  blob `GET`/`HEAD`; manifest `PUT`/`GET`/`HEAD`; `GET …/tags/list`. Returns the
  `Docker-Content-Digest` / `Docker-Distribution-Api-Version` headers and OCI
  `{errors:[…]}` bodies.
- **Name mapping** — `src/lib/packages/oci.ts` parses `/v2/<name>/…` and maps the
  image `<name>` to `{owner}/{repo}[/{image}]`, reusing the repo-scoping from the
  npm/files phase. OCI blobs are already sha256-addressed, so they drop straight
  into the existing `PodContentStore` — `docker`'s HEAD-before-push gives free
  dedup within an owner's pod.
- **Upload sessions** — `src/lib/packages/oci-uploads.ts`: an in-memory,
  process-global accumulator for the chunked POST→PATCH→PUT flow. Digest is
  verified on finalize (`DIGEST_INVALID` on mismatch).
- **Auth** — HTTP-Basic (`docker login`, push token as password); reuses the
  repo's push tokens. Bearer/JWT token endpoint is the documented v1.
- **Index** — manifests are indexed as `type='oci'` rows (by tag *and* by
  digest); raw layer/config blobs live in the CAS only. `validateVersion` now
  accepts digest-form refs; `validatePackageName` gained an OCI name grammar.
- **Tests** — `tests/packages-oci.test.ts` (routing classification, ref/name
  validation, upload-session concat). 32 unit tests pass.

**v0 limits** (see `docs/PACKAGES-PLAN.md`): in-memory uploads capped by
`MAX_PACKAGE_BLOB_BYTES` (no streaming yet → large layers unsupported);
Basic-only auth; no `?mount=` cross-repo blob mount.

## v0.7 — Mind Packages: pod-backed npm + generic-file registry (2026-06-01)

The fourth surface alongside Pages / Actions / Agents: a package registry whose
artifact bytes live in the owner's pod, mirroring Mind Pages. Built directly in
the bridge (no Verdaccio-as-backend, no forked forge) per
[`docs/PACKAGES-PLAN.md`](./PACKAGES-PLAN.md).

- **Content-addressed pod store** — `src/lib/packages/content-store.ts`.
  `PodContentStore` keys every blob by sha256 and writes it to
  `{pod}/public/packages/blobs/sha256/<aa>/<hex>` (public-read ACL, like Pages).
  Writes are idempotent (HEAD-before-PUT) and identical bytes dedup. Format-agnostic
  — ready for OCI layer blobs.
- **Index** — migration `015_packages.sql` + `src/lib/packages/store.ts`. One row per
  `(repo, type, name, version)` → blob digest + format metadata. Bytes in the pod,
  index in SQLite (the existing split).
- **npm** — `PUT/GET /api/packages/npm/{owner}/{repo}/…`. Publish decodes the inline
  base64 `_attachments` tarball into the CAS; packument GET rewrites each version's
  `dist.tarball` to a bridge URL and preserves client-computed integrity; tarball GET
  streams the blob back. Point `.npmrc` at the repo's registry base.
- **Generic files** — `PUT/GET /api/repos/{o}/{r}/files/{version}/{filename}`.
- **Auth reuses push tokens** — npm `Bearer` (`_authToken`) or HTTP-Basic; the same
  `scp_…` token that authorizes `git push` authorizes publishing.
- **Quotas** — `MAX_PACKAGE_BLOB_BYTES` (100 MiB, also an in-memory OOM guard until
  streaming lands) and `MAX_PACKAGE_BYTES_PER_REPO` (2 GiB).
- **Tests** — 3 new vitest files (CAS round-trip + dedup, index upsert/replace +
  quota sum, npm parse/packument). 29 unit tests pass; `015` applies in `smoke:db`.

Scoped to **repos** (not bare owners) so it reuses repo identity, visibility, and
push tokens — a refinement on the plan's owner-scoped sketch. **OCI/Docker is the
next phase** (needs streaming + large-blob handling + the `/v2/` mount); the CAS is
already built to carry it.

## v0.6.2 — Mind-branded CSS pages (login / pod welcome) (2026-05-30)

The Solid server (CommunitySolidServer) behind the bridge now serves
**Mind-branded pages** instead of stock CSS. New `infra/css/`: a Components.js
`config.json` that imports `css:config/file.json` and `Override`s four ids —
`StylesStaticAsset` (dark Mind stylesheet at `/.well-known/css/styles/main.css`),
`MainTemplateEngine` (`main.html.ejs` shell wrapping every rendered page —
login / consent / account / register / root), `RootStaticAsset` (`index.html`
landing), and `PodResourcesGenerator` (`pod-template/` so **new pods** get a Mind
"Welcome to your pod" README). `docker-compose.yml` mounts `./infra/css:/css-host`
and switches `--config` to it. `scripts/brand-pod-readmes.ts` (`npm run seed:readmes`)
re-seeds existing demo pods' READMEs (alice/mind/test2). Dark Mind theme (teal
`#16b88a`), matching mind-builder. **Dev only** — the prod rollout is documented in
`docs/DEPLOYMENT.md` but not yet applied. The branding recreates the look in plain
HTML/CSS (no React) reusing the `@mind-studio/ui` "mind" tokens.

## v0.6.1 — Agent roster simplified to a single conversational coder (2026-05-25)

Collapsed the `triager`/`engineer`/`scribe` roster down to one role: `coder`.
`ensureAgentsBootstrap` (`src/lib/agents/bootstrap.ts`) now registers exactly
that role, wired to the `coder` driver and firing on both `issue.created` and
`issue.commented`. The driver itself decides per-run whether to **implement**
(edit files → commit to `agent/issue-{n}` → open a draft PR) or **ask** (write
`.mind/agent-comment.md`, which is posted as an issue comment and triggers the
next round via `issue.commented`). No more label-driven handoff between roles;
the conversation in the issue thread is the loop. `MIND_ENABLE_ENGINEER_AGENT`
is gone — nothing branches on it anymore.

## v0.6 — Workflows, agents, multi-user, prod deployment (2026-05-23 → 2026-05-25)

A long iteration that turned the publishing demo into a small but credible
collaboration platform with a live deployment. Three threads ran in parallel.

### Collaboration primitives

- **Issues + comments** — pod-native (Turtle under `/codespaces/{repo}/issues/{n}/`),
  SQLite index for fast queries. Full CRUD via `/api/repos/{o}/{r}/issues` and
  `…/issues/{n}/comments`. Migrations `004_issues.sql`, `009_agent_comments.sql`.
- **Pull requests** — `pulls` table (migration `008_pull_requests.sql`), merge
  + close endpoints, diff-view component. PR Turtle on the pod is still pending
  (see PRODUCTION-READINESS §3.7).
- **Owner directory** — `/people` lists every WebID with pod-side profile cards;
  `/people/{owner}` renders the card. `seed:profiles` script writes them.

### Agents that respond to issue events

- **Driver ladder:** `echo` (no-op default) → `openrouter` (real model calls when
  `OPENROUTER_API_KEY` is set) → `coder` (opt-in via `MIND_ENABLE_ENGINEER_AGENT=1`).
- **`coder` driver** — clones the repo into a host tmpdir, runs
  `mind-codespaces/coder:latest` (opencode + `--dangerously-skip-permissions`)
  with `--read-only --cap-drop ALL --pids-limit=256 --security-opt no-new-privileges`,
  detached process-group so timeout-kills reap grandchildren. Commits to
  `agent/issue-{n}` after the container exits.
- **Roster:** `triager` on issue create, `engineer` on `issue.labeled=ready`,
  `scribe` on `issue.labeled=shipped`. Hand-fire via `POST /api/agents/dispatch`,
  introspect via `GET /api/agents`. `agent_runs` table (migrations 005/006/007)
  + per-run log streaming endpoint.

### Workflows (Step 1 + Step 2a + most of Step 2b — see WORKFLOWS-PLAN)

- **`.mind/workflow.yml`** runner with `run:` / `publish:` / `timeout:` and strict
  schema (unknown keys rejected).
- **Native + Docker runners**, auto-detected. Mode logged on every run.
- **Step 2b landed (mostly):** `--network=${MIND_WORKFLOW_NETWORK}` defaults to
  `none`; prod ships a Verdaccio sidecar on `mind-workflows` network with
  `MIND_NPM_REGISTRY` injected; per-workflow `--read-only --cap-drop ALL
  --pids-limit=512 --ulimit nofile=1024:1024`; log-capture cap at 5 MB
  (`MIND_WORKFLOW_LOG_LIMIT`); stuck-run reaper at boot.
- **Run history + manual rerun** — `workflow_runs` table, "Latest build" panel
  on `/repos/{o}/{r}`, `/repos/{o}/{r}/runs` list, `/repos/{o}/{r}/runs/{id}`
  detail, rerun button.
- **Seeded workflow demos:** `alice/marked-blog`, `alice/tailwind-site`,
  `alice/broken-build` via `npm run seed:workflows`.

### Multi-user signup + quotas

- **`POST /api/signup`** (gated on `BRIDGE_ENABLE_SIGNUP=1`, rate-limited,
  CSRF-guarded) proxies to CSS `/idp/register/`, persists a row in `users`,
  redirects to `/connect`. `/signup` page + `signup-form.tsx`.
- **`users` table** (migration `012_users.sql`) — `owner_slug`, `web_id`,
  `pod_root`, `email`. Free-string `repos.owner` retained for now; FK rewrite
  deferred.
- **Quotas** in `src/lib/registry/quotas.ts`: `MAX_REPOS_PER_OWNER=50`,
  `MAX_TOKENS_PER_REPO=10`, `MAX_RUNS_PER_OWNER_PER_DAY=500`,
  `MAX_DISK_PER_REPO_BYTES=1 GiB`. Push CGI checks disk on every push.
- **Second seeded user** — `mind` joins `alice` in `infra/css/seed.json` so
  demos can show an org alongside a personal account.

### BYOK AI providers + profile

- `/profile` and `/profile/ai-providers` let a signed-in user bring their own
  API keys (OpenRouter, OpenAI, Anthropic, Google). Keys stored in
  `user_ai_providers` (migration `013_user_ai_providers.sql`).
- `GET PUT /api/profile/ai/pref` selects default provider;
  `POST DELETE /api/profile/ai/keys/{provider}` writes/clears one.

### Production-readiness pass (P0 floor)

Entire P0 list from `docs/PRODUCTION-READINESS.md` shipped. Highlights:

- **Auth on every mutating route** — `src/lib/auth/session.ts` issues an
  HMAC-signed session cookie at the OIDC callback; readable `mc-csrf` mirror
  for double-submit CSRF. `requireSession` / `requireOwner` wired through.
- **Seeded fallback gated** — refused in `NODE_ENV=production` unless
  `ALLOW_SEEDED_FALLBACK=1`; `env.ts` refuses to boot in prod with the dev
  password.
- **Post-receive hook HMAC** (`BRIDGE_HOOK_SECRET`) + `npm run reinstall:hooks`
  for rotation.
- **OIDC hardening** — Origin/Sec-Fetch-Site CSRF check, WebID-issuer pinning,
  secure cookies, AES-256-GCM at-rest encryption of `identity_storage`
  (`IDENTITY_ENCRYPTION_KEY`).
- **`ownerPodRoot` verified** against the WebID's `pim:storage` set at repo
  creation.
- **Publisher walk hardening** — lstat-based symlink skip, expanded forbidden
  list (`.aws`, `.ssh`, `id_*`, `*.pem`, `*.key`, `.netrc`, `.npmrc`, …),
  50 MB per-file cap.
- **Rate limiting** (`src/lib/rate-limit.ts`) on 5 high-risk POSTs + per-(repo,
  IP) lockout on git-push Basic-auth failures.
- **CORS allowlist** (`src/proxy.ts`), JSON response cap (`src/lib/http/json.ts`,
  5 MB default).
- **Publish lock** (`src/lib/pages/publish-lock.ts`) — latest-wins coalescer.
- **HEAD↔last_published_sha reconciler** (migration `011`, `reconciler.ts`)
  boots from `src/instrumentation.ts`, runs every 5 min, exposed via
  `npm run reconcile:pages` and `POST /api/admin/reconcile`.
- **Publish-status surfacing** (migration `010`) — `PublishStatusBanner` with
  reauth link on `/repos/{o}/{r}`.
- **`createRepo` in a transaction**; `PRAGMA busy_timeout=5000`.
- **`/api/health`** now checks registry + git binary + pod + Docker; `/api/livez`
  is the cheap liveness probe; Dockerfile `HEALTHCHECK` targets it.

### Observability

- **Structured NDJSON logger** (`src/lib/log.ts`) with `LOG_LEVEL`/`LOG_FORMAT`,
  WebID scrubbing, correlation IDs via `AsyncLocalStorage` (request →
  publisher chain).
- **Prometheus metrics** at `/api/metrics` (bearer-auth via
  `BRIDGE_METRICS_TOKEN`) — `git_pushes_total`, `publish_total`,
  `workflow_runs_total`, `agent_calls_total`, `auth_failures_total`, plus Node
  process defaults.

### First test suite

- `vitest` wired (`npm test` / `npm run test:watch`). 8 passing across 4 files:
  `path-traversal`, `push-tokens`, `publisher-walk`, `quotas`. Integration
  tests are the remaining §3.2 backlog.

### Production deployment (Hetzner alpha)

- VM at `codespaces.duckdns.org` / `codespaces-pod.duckdns.org`.
- 5-service compose: caddy + bridge + css + socket-proxy + verdaccio
  (`infra/prod/docker-compose.yml`). Two networks: `mind`, `mind-workflows`.
- Bridge talks to Docker via `tecnativa/docker-socket-proxy` (P0-S9);
  the bridge container never sees `/var/run/docker.sock` directly.
- Auto-TLS via Caddy + Let's Encrypt; `flush_interval -1` for git Smart HTTP.
- CI workflow at `.github/workflows/deploy.yml` is wired (build → push GHCR →
  SSH → compose up) but hasn't fired yet — needs a `git tag v*`.
- Full runbook in `docs/DEPLOYMENT.md`.

### UI

- Editorial design language (serif display + monospace eyebrows + restrained
  palette) with light/dark/neo themes; navigation refactor moved to
  `src/components/main-nav.tsx` (the standalone `theme-toggle.tsx` is gone —
  toggle lives in the nav).
- New pages: `/how-it-works`, `/people`, `/people/{owner}`, `/profile`,
  `/profile/ai-providers`, `/signup`, `/login`, `/repos/{o}/{r}/settings`,
  `/repos/{o}/{r}/pulls/...`.
- Repo detail is two-column at `lg+` (main + sidebar), single-column on mobile.
- Code browser at `/repos/{o}/{r}/{tree,blob}/...`; markdown READMEs rendered
  with explicit list-style / font-weight overrides (Tailwind v4 preflight
  strips them).

## v0.5 — Cleanup pass

- Extracted `ensureContainer` + `setPublicReadAcl` into `src/lib/solid/containers.ts` (the two copies in `publisher.ts` and `repo-metadata.ts` were bit-for-bit identical).
- Updated README to document `/connect`, `/identities`, push tokens, and the full endpoint surface.
- Refreshed PRD: M8–M11 marked as shipped; "what gets unlocked" rewritten as a forward-looking list (no longer mentions things we already built).
- Fixed stale comment on the `push_tokens` migration ("placeholder, not used in MVP" → describes the actual behaviour).
- Added this changelog.

## v0.4 — Real Solid-OIDC delegation (M11)

- `/connect` page kicks off the full Inrupt SDK authorization-code flow against the pod's OIDC issuer. Dynamic client registration as **Mind Codespaces**; the user sees a real CSS consent screen.
- Tokens persisted to SQLite via a custom `IStorage` (`src/lib/registry/identities.ts`) backing the SDK's `Session` model. `identities` table maps `WebID → session_id`; `identity_storage` is the SDK's K/V.
- `/identities` page lists connected pods, supports disconnect (drops the mapping + KV rows).
- New `src/lib/solid/fetch-for-owner.ts` exposes `getOwnerFetch(webId)` returning `{ fetch, mode: 'delegated' | 'seeded' }` — publisher and metadata writer both went through it. Delegated wins when available; seeded credentials remain as fallback for unconnected WebIDs (keeps the existing demo working without forcing the OIDC flow).
- Dev log gained `[publisher] auth mode: delegated|seeded` to make the source of auth visible end-to-end.

## v0.3 — Stretch milestones (M8 + M9 + M10)

- **M8 — Pod-side repo metadata:** `solidgit:Repository` Turtle written to `{podRoot}/codespaces/{name}/index.ttl` on POST /repos, PATCH /repos/.../, and PUT /pages. Best-effort; pod failures log but don't break the API call. New `src/lib/vocab.ts` namespace module.
- **M9 — Push tokens:** `scp_…` plaintext tokens, `sha256` at rest. CRUD under `/api/repos/{o}/{r}/tokens`. Git Smart HTTP gate: always required for `git-receive-pack`; required for `git-upload-pack` when `visibility=private`. 401 with `WWW-Authenticate: Basic realm="owner/repo"`. Username is ignored — any holder of a valid token wins.
- **M10 — Dashboard + seed-demo:** `/repos` list + `/repos/{o}/{r}` detail page (clone URL, owner WebID, pod root + metadata Turtle link, Pages config, token manager). `scripts/seed-demo.ts` (idempotent) creates `alice/bakery` (multi-page bakery site) and `alice/notes` (notebook), mints a token per repo, force-pushes, waits for publish.

## v0.2 — Rename: "Solid Pages" → "Mind Pages" (the feature)

- The publishing feature (the GitHub-Pages parallel inside the prototype) is now **Mind Pages**. The prototype itself remains **Mind Codespaces**. The PRD title is "Mind Codespaces — Solid Git Bridge + Mind Pages MVP PRD".
- Distinction: **Mind Codespaces** = product / prototype; **Mind Pages** = the artifact you `git push` into your pod.

## v0.1 — MVP (M0–M7)

- **M0 — PRD authored.** Vision, architecture diagram, milestones, scope (in/out).
- **M1 — Scaffolding.** Next.js 16 + TypeScript + Tailwind on :3010, `/api/health`.
- **M2 — Single CSS Docker instance.** CommunitySolidServer v7 on :3011 with seeded `alice` user.
- **M3 — Repo registry.** SQLite with `repos`, `pages_configs`, `push_tokens`. CRUD under `/api/repos`. Strict name validation, path-traversal-proof.
- **M4 — Bare git repo creation.** `git init --bare` under `.git-data/repos/{owner}/{name}.git/`. Path resolution boundary check. Rollback registry row on git failure.
- **M5 — Git Smart HTTP delegation.** `/api/git/{o}/{r}/[...path]` spawns `git http-backend` as CGI; streams stdin in, parses CGI headers out, streams response. `git clone` and `git push` work.
- **M6 — Post-receive event.** Hook installed at repo-creation time `curl`s `/api/git/internal/post-receive` (loopback). Handler logs `repo.updated`, schedules publish if the ref matches.
- **M7 — Pages publisher.** Checkout source branch to temp dir → walk source path (skip `.git`/`.env`/`node_modules`) → PUT each file to the configured Solid container with the right MIME type. Sets `/public/` ACL to public-read idempotently. End-to-end: `git push` → site live at a pod URL.

## Operational notes

- The post-receive hook bakes the bridge's callback URL **and HMAC secret**
  at install time (read from `BRIDGE_INTERNAL_URL` / `BRIDGE_HOOK_SECRET`).
  Rotating either secret requires `npm run reinstall:hooks` on every existing
  repo.
- The OIDC dynamic client registration is stored inside the pod's OIDC issuer
  state (CSS keeps it under `.account/`). If you `rm -rf .css-data`, you need
  to re-authorize via `/connect`. Existing identities in the bridge's SQLite
  become stale.
- Both prototypes (`mind-market-v0`, `codespaces`) currently share the
  same `:3011` port for their CSS instances. Run one at a time.
