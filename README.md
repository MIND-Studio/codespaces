# mind-codespaces-v0

Solid Git Bridge prototype — `git push` your site into your own Solid Pod,
with a workflow runner and issue-driven agents on top. Sibling of `mind-market-v0`.

See [`docs/PRD.md`](./docs/PRD.md) for the vision and current shape,
[`docs/CHANGELOG.md`](./docs/CHANGELOG.md) for what shipped in each iteration,
[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for the Hetzner alpha runbook,
[`docs/PRODUCTION-READINESS.md`](./docs/PRODUCTION-READINESS.md) for what's still open.

## What this is

You `git push` to a local bridge. The bridge keeps the bare repository on disk
and publishes the configured branch — directly, or after running a
`.mind/workflow.yml` build inside an ephemeral Docker container — into your
Solid Pod as a plain static website (the **Mind Pages** feature). Identity,
repo metadata, issues, and the published artifact all live in your pod; the
bridge is just protocol glue.

## Shared packages (GitHub Packages)

The dashboard installs `@mind-studio/core` and `@mind-studio/ui` from **GitHub Packages**.
A committed `.npmrc` scopes `@mind-studio` to that registry; before installing, export a
GitHub token with `read:packages` (`export NODE_AUTH_TOKEN=<PAT>`). CI/CD passes the token
to the Docker build as the `node_auth_token` BuildKit secret (see `release.yml`).

## Dev setup

```bash
# 1. Start a local Community Solid Server (two seeded users, see below)
docker compose up -d

# 2. Install deps and start the bridge on :3010
npm install
npm run dev

# 3. Seed demo repos (idempotent)
npm run seed:demo        # alice/{bakery, notes, about, built-site}
npm run seed:workflows   # alice/{marked-blog, tailwind-site, broken-build}
npm run seed:profiles    # writes pod-side profile cards for alice + mind
```

Then open <http://localhost:3010> for the dashboard, or jump to a published site:

- <http://localhost:3011/alice/public/sites/bakery/index.html>
- <http://localhost:3011/alice/public/sites/about/index.html>

## Signing in

The mutating routes (`POST/PATCH/PUT/DELETE`) require a session cookie. Two
ways to get one in dev:

- **`/login`** — password sign-in against a seeded CSS user (dev only).
- **`/connect`** — full Solid-OIDC authorization-code flow against any pod
  issuer. After this, the publisher uses your delegated refresh token instead
  of the seeded credentials; the dev log shows `auth mode: delegated`.

Connected pods are managed at `/identities`.

## Try it from the command line

Mutating routes require the session cookie issued by `/login` or `/connect`,
so the easiest CLI flow is: sign in in the browser, then drive the API from
that same browser's `curl` (or use the dashboard at `/repos/new`).

If you want a scriptable flow, hit `/api/auth/login` with the seeded
credentials and reuse the cookie jar:

```bash
# 1. Sign in and stash the cookies
curl -fsS -c cookies.txt -X POST http://localhost:3010/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@mind-codespaces.local","password":"dev-only-do-not-use-in-prod"}'
CSRF=$(grep mc-csrf cookies.txt | awk '{print $7}')

# 2. Create a repo, configure Pages, mint a push token
curl -fsS -b cookies.txt -H "x-mc-csrf: $CSRF" -X POST http://localhost:3010/api/repos \
  -H 'Content-Type: application/json' \
  -d '{"owner":"alice","name":"hello","ownerWebId":"http://localhost:3011/alice/profile/card#me","ownerPodRoot":"http://localhost:3011/alice/","visibility":"public"}'

curl -fsS -b cookies.txt -H "x-mc-csrf: $CSRF" -X PUT http://localhost:3010/api/repos/alice/hello/pages \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true,"sourceBranch":"main","sourcePath":"/","targetContainer":"http://localhost:3011/alice/public/sites/hello/"}'

TOKEN=$(curl -fsS -b cookies.txt -H "x-mc-csrf: $CSRF" -X POST http://localhost:3010/api/repos/alice/hello/tokens \
  -H 'Content-Type: application/json' -d '{"label":"my laptop"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

# 3. Push (Git Smart HTTP doesn't need the session — it uses the push token)
mkdir /tmp/hello && cd /tmp/hello
echo '<!doctype html><h1>Hello from Mind Pages</h1>' > index.html
git init -b main && git add . && git commit -m init
git push "http://me:${TOKEN}@localhost:3010/api/git/alice/hello.git" main

# 4. Open it
open http://localhost:3011/alice/public/sites/hello/index.html
```

## Workflows

Drop `.mind/workflow.yml` in any repo:

```yaml
run:
  - npm ci
  - npm run build
publish: dist     # optional — only meaningful with Pages enabled
timeout: 600      # optional, seconds, default 300, max 1800
```

On push, the runner picks the file up and executes the commands. The runner
auto-detects Docker:

- **Docker available** (the default in prod, and locally if Docker is running):
  one ephemeral `node:22-alpine` container per workflow, host UID,
  `--memory=2g --cpus=2 --read-only --cap-drop ALL --pids-limit=512`.
  Network defaults to `none`; in prod it joins the `mind-workflows` network
  where a Verdaccio sidecar proxies npm. Force with `MIND_RUNNER=docker`.
- **Docker unavailable**: native `sh -c` on the host with no sandbox.
  Force with `MIND_RUNNER=native`.

Mode is logged on every run (`[runner: docker]` / `[runner: native]`). Run
history + log tail lives in `workflow_runs` and surfaces on `/repos/{o}/{r}`
and `/repos/{o}/{r}/runs`. See [`docs/WORKFLOWS-PLAN.md`](./docs/WORKFLOWS-PLAN.md)
for the design rationale.

## Agents — roles that respond to issue events

Issues are pod-native (Turtle under `/codespaces/{repo}/issues/{n}/issue.ttl`).
A single **`coder`** role responds to issue events — it fires on both
`issue.created` and `issue.commented`, so a conversation in the issue thread
drives the loop. Each run, the `coder` driver decides per-turn whether to
**implement** (edit files, commit to `agent/issue-{n}`, open a draft PR) or
**ask** (write `.mind/agent-comment.md`, which the bridge posts back as an
issue comment — that comment then fires the next round).

Drivers:
- **`echo`** — default no-op stub. Always registered.
- **`coder`** — opencode-in-container. Always registered. Resolves
  credentials via `resolveCoderConfig(ownerWebId)`: first the repo owner's
  BYOK key at `/profile/ai-providers`, then the bridge-wide
  `OPENROUTER_API_KEY` env, then a clear "no provider configured" error.
- **`openrouter`** — env-only text driver. Registered when
  `OPENROUTER_API_KEY` is set.

Credentials, two paths — equivalent at the dispatch layer:
1. **BYOK (per user)** — sign in, go to `/profile/ai-providers`, paste a
   key for OpenRouter / OpenAI / Anthropic / Google, then pick a default
   provider+model. The coder uses your key for any repo you own.
2. **Bridge-wide fallback** — operator sets `OPENROUTER_API_KEY` (and
   optionally `MIND_AGENT_MODEL`) on the bridge itself. Used for owners
   who haven't configured BYOK. Anyone with shell access to the bridge
   process can read the key — prefer BYOK in shared deployments.

If neither is configured for an owner, the coder driver returns a
"no provider configured" error and points the owner at
`/profile/ai-providers`.

The agents subsystem has a different threat profile than the rest of the
bridge — `opencode` runs with `--dangerously-skip-permissions` inside the
sandbox. **Read [`docs/PRODUCTION-READINESS.md`](./docs/PRODUCTION-READINESS.md) §6**
before pointing this at anything you don't control.

Hand-fire dispatches via `POST /api/agents/dispatch`; introspect roles via
`GET /api/agents`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Landing |
| GET | `/repos`, `/repos/{o}/{r}` | Dashboard, repo detail |
| GET | `/repos/{o}/{r}/{tree,blob}/...` | Code browser |
| GET | `/repos/{o}/{r}/{issues,pulls,runs,settings}` | Repo subpages |
| GET | `/people`, `/people/{owner}` | Owner directory + profile view |
| GET | `/profile`, `/profile/ai-providers` | User profile + BYOK AI keys |
| GET | `/connect`, `/identities` | Pod authorization + connected pods |
| GET | `/login`, `/signup`, `/how-it-works` | Auth + walkthroughs |
| GET | `/api/health`, `/api/livez`, `/api/metrics` | Probes + Prometheus (bearer-auth) |
| GET POST | `/api/repos` | List, create repo |
| GET PATCH DELETE | `/api/repos/{o}/{r}` | Detail, update, delete |
| GET PUT | `/api/repos/{o}/{r}/pages` | Read, write Pages config |
| GET POST | `/api/repos/{o}/{r}/tokens` · DELETE `/{id}` | Push-token CRUD |
| GET POST | `/api/repos/{o}/{r}/issues` · GET PATCH `/{n}` | Issue CRUD |
| GET POST | `/api/repos/{o}/{r}/issues/{n}/comments` | Issue comments |
| GET POST | `/api/repos/{o}/{r}/pulls` · GET `/{n}` · POST `/{n}/merge` · `/{n}/close` | PR CRUD |
| GET POST | `/api/repos/{o}/{r}/runs` · GET `/{id}` | Workflow run history + manual rerun |
| GET | `/api/agent-runs/{id}` · `/{id}/log` | Agent run detail + log tail |
| GET POST | `/api/agents`, `/api/agents/dispatch` | Roster introspection + hand-fire |
| GET POST | `/api/git/{o}/{r}.git/...` | Git Smart HTTP (clone/fetch/push) |
| POST | `/api/git/internal/post-receive` | Loopback hook callback (HMAC-signed) |
| POST | `/api/auth/{start,login,logout}` · GET `/api/auth/callback` | OIDC + session |
| DELETE | `/api/identities/{webId}` | Disconnect identity |
| GET PUT | `/api/profile/ai/pref` · POST DELETE `/api/profile/ai/keys/{provider}` | BYOK AI provider keys |
| POST | `/api/signup` | Account creation (gated on `BRIDGE_ENABLE_SIGNUP=1`) |
| POST | `/api/admin/reconcile` | Force HEAD↔last_published_sha reconcile (bearer-auth) |

## Ports

| Service | Port |
|---|---|
| CommunitySolidServer (single instance) | 3011 |
| Bridge / Next.js | 3010 |

`mind-codespaces-v0` deliberately uses `:3011` so it can run alongside
`mind-market-v0` (which uses `:3001` and `:3002` for its CSS instances).

## Demo users

Two accounts seeded into the local CSS instance (`infra/css/seed.json`):

| Email | Password | Pod | WebID |
|---|---|---|---|
| `alice@mind-codespaces.local` | `dev-only-do-not-use-in-prod` | `http://localhost:3011/alice/` | `http://localhost:3011/alice/profile/card#me` |
| `mind@mind-codespaces.local`  | `dev-only-do-not-use-in-prod` | `http://localhost:3011/mind/`  | `http://localhost:3011/mind/profile/card#me` |

`mind` exists so demos can show an "org" owner alongside a personal one.
**Never reuse these credentials anywhere non-local.**

## Environment variables

Defaults match the local Docker setup. In `NODE_ENV=production` the bridge
refuses to start when any of the **required** secrets are missing or wrong size
(see [`docs/PRODUCTION-READINESS.md`](./docs/PRODUCTION-READINESS.md) §2 and
`infra/prod/.env.example`).

| Var | Default | Used by |
|---|---|---|
| `BRIDGE_PUBLIC_URL` | `http://localhost:3010` | OIDC redirect base, secure-cookie origin |
| `BRIDGE_INTERNAL_URL` | `http://127.0.0.1:3010` | Post-receive hook callback (loopback in prod) |
| `POD_BASE_URL` | `http://localhost:3011/` | CSS URL — `/connect` default + seeded-fallback target |
| `POD_USER_EMAIL` / `POD_USER_PASSWORD` | alice's seeded creds | Seeded-credential fallback (dev only) |
| `ALLOW_SEEDED_FALLBACK` | unset | Must be `1` to allow seeded creds in prod (don't) |
| `GIT_DATA_DIR` | `./.git-data/repos` | Bare git repo storage |
| `REGISTRY_DATA_DIR` | `./.registry-data` | SQLite DB + synthesized dev secrets |
| `BRIDGE_SESSION_SECRET` | dev: auto-synthesized | **Required in prod.** 32-byte HMAC key for session cookies |
| `BRIDGE_HOOK_SECRET` | dev: auto-synthesized | **Required in prod.** Baked into each repo's post-receive hook |
| `IDENTITY_ENCRYPTION_KEY` | dev: auto-synthesized | **Required in prod.** 32-byte AES-256-GCM key for refresh-token storage |
| `BRIDGE_ADMIN_TOKEN` / `BRIDGE_METRICS_TOKEN` | unset (endpoint disabled) | Bearer for `/api/admin/reconcile` and `/api/metrics` |
| `BRIDGE_CORS_ALLOWED_ORIGINS` | (none) | Extra origins permitted by the `/api/*` CORS allowlist |
| `BRIDGE_ENABLE_SIGNUP` | unset | Set `1` to enable `POST /api/signup` + `/signup` page |
| `MAX_REPOS_PER_OWNER` / `MAX_TOKENS_PER_REPO` / `MAX_RUNS_PER_OWNER_PER_DAY` / `MAX_DISK_PER_REPO_BYTES` | 50 / 10 / 500 / 1 GiB | Per-owner quotas (return 429 `QUOTA_EXCEEDED`) |
| `OPENROUTER_API_KEY` | unset | Bridge-wide fallback key. Enables the env-only `openrouter` driver, and serves as the coder driver's fallback when a repo owner hasn't configured BYOK at `/profile/ai-providers`. The coder driver itself is always registered. |
| `MIND_AGENT_MODEL` | `qwen/qwen3-coder:free` | OpenRouter model id used as the bridge-wide fallback. Default is a free coder-tuned model so a bridge with no per-user BYOK keys still runs end-to-end without burning credits. Pinning a paid model requires the operator-side OpenRouter key to carry the matching budget. |
| `MIND_RUNNER` | `auto` | Force workflow runner: `docker` \| `native` \| `auto` |
| `MIND_WORKFLOW_NETWORK` | `none` | Docker network for workflow containers (`bridge`/custom for npm access) |
| `MIND_NPM_REGISTRY` | unset | Injected into workflow containers as `npm_config_registry` (Verdaccio mirror) |
| `MIND_CODER_IMAGE` | `mind-codespaces/coder:latest` | Sandbox image for the `coder` driver |
| `MIND_RECONCILE_INTERVAL_MS` | 300000 | HEAD↔last_published_sha reconciler cadence |

## Tests

```bash
npm test            # vitest run (path-traversal, push-tokens, publisher walk, quotas)
npm run smoke:db    # apply registry migrations against a throwaway DB
npx tsc --noEmit    # type check
```

8 unit tests pass. Integration tests (Smart HTTP round-trip, live-CSS publish,
OIDC roundtrip, concurrent push, reconciler) are the §3.2 backlog in
PRODUCTION-READINESS.

## Layout

- `src/app/` — Next.js App Router (landing, dashboard, API routes, auth, profile)
- `src/lib/registry/` — SQLite + numbered SQL migrations under `migrations/`
- `src/lib/git/` — Bare repo creation, Smart HTTP CGI delegation, checkout/diff/merge
- `src/lib/pages/` — Publisher, publish-lock, reconciler, MIME map
- `src/lib/solid/` — Containers, ACLs, OIDC delegation, profile dereferencing, repo-metadata
- `src/lib/workflows/` — `.mind/workflow.yml` parser + native/Docker runners
- `src/lib/agents/` — Dispatch, registry, drivers (`echo`/`openrouter`/`coder`)
- `src/lib/auth/`, `src/lib/rate-limit.ts`, `src/lib/http/json.ts`, `src/proxy.ts` — Session, CSRF, rate limits, CORS
- `src/lib/log.ts`, `src/lib/metrics.ts`, `src/lib/env.ts`, `src/instrumentation.ts` — Observability + boot
- `infra/css/seed.json` — Bootstraps the CSS accounts
- `infra/prod/` — Production stack (Dockerfile, compose, Caddyfile, Verdaccio, scripts)
- `infra/coder/` — Coder-driver sandbox image
- `scripts/seed-*.ts`, `import-repo.ts`, `smoke-db.ts`, `reinstall-hooks.ts`, `backup-registry.ts`, `reconcile-pages.ts`
- `.git-data/`, `.css-data/`, `.registry-data/` (all gitignored)
