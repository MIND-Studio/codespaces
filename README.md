# mind-codespaces-v0

Solid Git Bridge prototype — `git push` your site into your own Solid Pod. Sibling of `mind-market-v0`.

See [`docs/PRD.md`](./docs/PRD.md) for the full vision, [`docs/CHANGELOG.md`](./docs/CHANGELOG.md) for what shipped in each iteration.

## What this is

You `git push` to a local bridge. The bridge keeps the bare repository on disk
and publishes the configured branch into your Solid Pod as a plain static
website (the **Mind Pages** feature). Identity, repo metadata, and the
published artifact all live in your pod; the bridge is just protocol glue.

## Dev setup

```bash
# 1. Start a local Community Solid Server (single pod, demo user `alice`)
docker compose up -d

# 2. Install deps and start the bridge on :3010
npm install
npm run dev

# 3. Seed two demo repos with example sites (optional, but recommended)
npm run seed:demo
```

Then open <http://localhost:3010/repos> for the dashboard, or jump straight to
the published sites:

- <http://localhost:3011/alice/public/sites/bakery/index.html>
- <http://localhost:3011/alice/public/sites/notes/index.html>

## Try it from the command line

```bash
# Create a repo
curl -X POST http://localhost:3010/api/repos -H 'Content-Type: application/json' -d '{
  "owner":"alice",
  "name":"hello",
  "ownerWebId":"http://localhost:3011/alice/profile/card#me",
  "ownerPodRoot":"http://localhost:3011/alice/",
  "visibility":"public"
}'

# Configure Mind Pages
curl -X PUT http://localhost:3010/api/repos/alice/hello/pages -H 'Content-Type: application/json' -d '{
  "enabled":true,
  "sourceBranch":"main",
  "sourcePath":"/",
  "targetContainer":"http://localhost:3011/alice/public/sites/hello/"
}'

# Mint a push token (needed for every push; also for clone if visibility=private)
TOKEN=$(curl -fsS -X POST http://localhost:3010/api/repos/alice/hello/tokens \
  -H 'Content-Type: application/json' -d '{"label":"my laptop"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

# Push a site
mkdir /tmp/hello && cd /tmp/hello
echo '<!doctype html><h1>Hello from Mind Pages</h1>' > index.html
git init -b main && git add . && git commit -m init
git push "http://me:${TOKEN}@localhost:3010/api/git/alice/hello.git" main

# Open it
open http://localhost:3011/alice/public/sites/hello/index.html
```

## Agents — roles that respond to issues

Each repo has an **issues** primitive (pod-native; one Turtle document per
issue under `/codespaces/{repo}/issues/{n}/issue.ttl`) and a roster of
named **agents** that respond to issue events. The default roster is:

| Role | Fires on | Does |
|---|---|---|
| `triager` | new issue created | classifies + proposes priority/labels |
| `engineer` | issue labeled `ready` | (placeholder — needs the opencode driver to edit code) |
| `scribe` | issue labeled `shipped` | drafts a one-line changelog entry |

The agents module is **pluggable**: drivers are registered at boot. Without
a key, the built-in `echo` driver records each fire as a no-op so you can
verify the dispatch path. With `OPENROUTER_API_KEY` set, the `openrouter`
driver replaces it and each role talks to a real model.

The noun "team" is intentionally not used here — it's reserved for a
later concept of human collaborators with project access.

### Try it

```bash
# 1. start the stack as usual
docker compose up -d
npm install
npm run seed:demo

# 2. give the bridge your key. Easiest: drop it into .env.local,
#    which Next.js auto-loads at dev-server start and which is
#    gitignored. Inline env vars on the npm command still work too.
cat > .env.local <<EOF
OPENROUTER_API_KEY=sk-or-…
MIND_AGENT_MODEL=nvidia/nemotron-3-super-120b-a12b:free
EOF
npm run dev

# 3. file a new issue — the agents auto-fire on creation
open http://localhost:3010/repos/alice/bakery/issues/new
# OR via curl:
curl -X POST http://localhost:3010/api/repos/alice/bakery/issues \
  -H 'Content-Type: application/json' \
  -d '{"title":"Add a contact form","body":"Customers want to email orders.","priority":"normal"}'

# 4. open the issue — "Agent activity" panel shows the triager's response
```

`POST /api/agents/dispatch` is also available for hand-firing events
without creating an issue:

```bash
curl -X POST http://localhost:3010/api/agents/dispatch \
  -H 'Content-Type: application/json' \
  -d '{"type":"issue.labeled","repoOwner":"alice","repoName":"notes","issueNumber":1,"label":"ready"}'
```

`GET /api/agents` introspects the registered roles and drivers.

## Identity — Solid-OIDC delegation

By default the publisher writes to alice's pod using **seeded credentials**
(a known dev account, fine for the demo). For a real flow:

1. Open <http://localhost:3010/connect>
2. Enter your pod's OIDC issuer (default `http://localhost:3011/`)
3. Authenticate at the pod's login page, click **Authorize**
4. The bridge dynamically registers itself as an OIDC client named
   "Mind Codespaces" and stores the resulting refresh token in
   `.registry-data/`
5. From now on the publisher uses your delegated token instead of the
   seeded credentials; the dev log will show `[publisher] auth mode: delegated`

Disconnect from <http://localhost:3010/identities>.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Landing page |
| GET | `/repos` | Dashboard list of all repos |
| GET | `/repos/{owner}/{repo}` | Repo detail (clone URL, Pages config, token manager) |
| GET | `/connect` | Authorize a pod via Solid-OIDC |
| GET | `/identities` | Connected pods (disconnect here) |
| GET | `/api/health` | Health check |
| GET POST | `/api/repos` | List, create repo |
| GET PATCH | `/api/repos/{o}/{r}` | Detail, update visibility/branch |
| GET PUT | `/api/repos/{o}/{r}/pages` | Read, write Pages config |
| GET POST | `/api/repos/{o}/{r}/tokens` | List, mint push token |
| DELETE | `/api/repos/{o}/{r}/tokens/{id}` | Revoke token |
| GET POST | `/api/git/{o}/{r}.git/...` | Git Smart HTTP (clone/fetch/push) |
| POST | `/api/git/internal/post-receive` | Loopback hook callback |
| POST | `/api/auth/start` | Begin OIDC flow |
| GET | `/api/auth/callback` | OIDC redirect target |
| DELETE | `/api/identities/{webId}` | Disconnect identity |

## Ports

| Service | Port |
|---|---|
| CommunitySolidServer (single instance) | 3011 |
| Bridge / Next.js | 3010 |

`mind-codespaces-v0` deliberately uses `:3011` so it can run alongside
`mind-market-v0` (which uses `:3001` and `:3002` for its CSS instances).

## Demo user

Single seeded account on the CSS instance:

| Email | Password | Pod | WebID |
|---|---|---|---|
| `alice@mind-codespaces.local` | `dev-only-do-not-use-in-prod` | `http://localhost:3011/alice/` | `http://localhost:3011/alice/profile/card#me` |

**Never reuse these credentials anywhere non-local.**

## Environment variables

All optional — the defaults match the local Docker setup.

| Var | Default | Used by |
|---|---|---|
| `BRIDGE_PUBLIC_URL` | `http://localhost:3010` | Post-receive hook callback URL; OIDC redirect URL |
| `POD_BASE_URL` | `http://localhost:3011/` | Default CSS URL for the publisher's seeded fallback + `/connect` form |
| `POD_USER_EMAIL` | `alice@mind-codespaces.local` | Seeded-credential fallback |
| `POD_USER_PASSWORD` | `dev-only-do-not-use-in-prod` | Seeded-credential fallback |
| `GIT_DATA_DIR` | `./.git-data/repos` | Bare git repo storage |
| `REGISTRY_DATA_DIR` | `./.registry-data` | SQLite DB |
| `OPENROUTER_API_KEY` | unset | Agents module — when set, the `openrouter` driver replaces the `echo` stub as the default. |
| `MIND_AGENT_MODEL` | `anthropic/claude-3.5-sonnet` | Agents module — OpenRouter model id passed on every chat call. |

## Layout

- `src/app/` — Next.js App Router (landing, dashboard pages, API routes)
- `src/lib/registry/` — SQLite (repos, pages_configs, push_tokens, identities, identity_storage)
- `src/lib/git/` — Bare repo creation, Smart HTTP CGI delegation, checkout helper
- `src/lib/pages/` — Pages publisher + MIME map
- `src/lib/solid/` — Container/ACL helpers, seeded-credential auth, OIDC delegation, repo-metadata writer
- `src/lib/vocab.ts` — `solidgit:`, `dcterms:`, `xsd:` namespaces
- `infra/css/seed.json` — Bootstraps alice's CSS account
- `scripts/seed-demo.ts` — Creates `alice/bakery` and `alice/notes` end-to-end
- `.git-data/` (gitignored) — Bare git repos
- `.css-data/` (gitignored) — CSS persistent storage
- `.registry-data/` (gitignored) — SQLite DB
