# Orientation

The user-facing README is the source of truth for commands, endpoints, ports, env vars, demo user, and layout — imported below. `docs/IDEA.md` has the design rationale; `docs/CHANGELOG.md` is what actually shipped (the README occasionally lags).

@README.md

# Agent-only notes (not in README)

- The parent `/Users/heussers/develop/mind/CLAUDE.md` describes a *different* project (Mind Cube — a Raspberry Pi AI assistant). Ignore it here. The relevant parent doc is `mind-prototypes/CLAUDE.md`.
- **`npm test` runs vitest** (path-traversal, push-tokens, publisher walk, quotas, and the four `packages-*` suites — 32 tests as of v0.8.1). `npm run smoke:db` applies registry migrations against a throwaway DB; `npx tsc --noEmit` type-checks. Integration tests (live-CSS publish, Smart-HTTP round-trip, OIDC) are still backlog — see PRODUCTION-READINESS §3.2.
- The README's command list omits a few `tsx` scripts: `seed:profiles`, `seed:workflows`, `import:repo`, `smoke:db`. See `scripts/` and `package.json`.
- Wiping `.css-data/` invalidates every OIDC dynamic-client registration; bridge identity rows in SQLite go stale and you must re-authorize via `/connect`. **This also blocks package/Pages writes:** the write path (`getOwnerFetch`) never falls back to seeded creds once a *stale* delegated identity exists, even in dev — re-`/connect`, or delete the identity (`DELETE /api/identities/{webId}`) and set `ALLOW_SEEDED_FALLBACK=1` (dev-only).
- `.git-data/repos/{owner}/{name}.git/hooks/post-receive` bakes `BRIDGE_PUBLIC_URL` at *creation* time. Changing the env var later means re-creating the repo or `sed`-ing the hook file.

## Mind Packages (`src/lib/packages/`, the `/v2/` OCI mount)

- Three formats (`npm`/`oci`/`file`) share one content-addressed `PodContentStore`; bytes go to `{podRoot}/public/packages/blobs/sha256/…`, the SQLite index (`015_packages.sql`) maps `(repo,type,name,version)` → digest. Auth reuses repo **push tokens**. Design rationale: `docs/adr/0001-mind-packages-in-the-bridge.md`.
- **`/v2/` needs `skipTrailingSlashRedirect: true`** (`next.config.ts`): docker's version ping is `GET /v2/` *with* the slash, and a 308 → `/v2` reads as "not a v2 registry". Don't remove it.
- **`docker login` over plain `localhost` does NOT work on Docker Desktop** (daemon-in-VM forces HTTPS). For a real CLI round-trip use `crane`/`skopeo` with `--insecure` against `host.docker.internal:3010`, or add `insecure-registries`. The wire protocol itself is fine.
- OCI blob uploads buffer **in memory** (capped by `MAX_PACKAGE_BLOB_BYTES`) — no streaming yet, so very large layers fail. Manifests are indexed by tag *and* digest; raw layers/configs live in the CAS only.
- The CSRF header for mutating `/api/*` routes is `X-CSRF-Token` (cookie `mc-csrf`); `/api/auth/login` also requires an `Origin` (or `Sec-Fetch-Site`) same-origin signal.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# This is NOT the Solid setup you assume

The two prototypes in `marketplaces-prototypes/` share a Solid stack (Community Solid Server v7 via Docker) but are otherwise independent apps with their own ports and data dirs. Before changing anything Solid-related, skim `src/lib/solid/` here AND in `../mind-market-v0/src/lib/solid/` — the patterns differ.

# Turbopack CSS hot-reload is unreliable

If a CSS change isn't visible — even after restarting the dev server — the cached bundle in `.next/` is stale. `rm -rf .next && npm run dev` forces a fresh compile. Verified once: a new `.markdown-body ul { list-style-type: disc; }` rule kept being absent from the served bundle until the cache was wiped.

# Workflow runner auto-detects Docker

`runWorkflow` probes `docker info` once at first use. If Docker is reachable, every workflow's `run:` commands execute inside a single `node:22-alpine` container (`--rm --user $(uid):$(gid) --memory=2g --cpus=2`, bind-mount the temp checkout at `/work`). Otherwise it falls back to native `sh -c` on the host with no sandbox. The chosen mode is logged at the top of every run's log (`[runner: docker]` / `[runner: native]`). Force one with `MIND_RUNNER=docker` or `MIND_RUNNER=native`. The Docker path needs `node:22-alpine` pulled (~150MB); the first cold run pays the pull cost. The publish step runs back on the host *after* the container exits — that's why the container runs as the host UID, so file ownership in the bind mount doesn't trip up the publisher. See `docs/WORKFLOWS-PLAN.md` for the threat-model boundary (step 2a sandboxes from the host fs, not from the network).

## Agent skills

### Issue tracker

Issues and PRDs live as markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, used verbatim. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
