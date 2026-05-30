# Changelog

What shipped in each iteration. Most-recent at the top.

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
- Both prototypes (`mind-market-v0`, `mind-codespaces-v0`) currently share the
  same `:3011` port for their CSS instances. Run one at a time.
