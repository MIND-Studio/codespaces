# Orientation

The user-facing README is the source of truth for commands, endpoints, ports, env vars, demo user, and layout — imported below. `docs/PRD.md` has the design rationale; `docs/CHANGELOG.md` is what actually shipped (the README occasionally lags).

@README.md

# Agent-only notes (not in README)

- The parent `/Users/heussers/develop/mind/CLAUDE.md` describes a *different* project (Mind Cube — a Raspberry Pi AI assistant). Ignore it here. The relevant parent doc is `mind-prototypes/CLAUDE.md`.
- **No test runner is configured.** No `npm test`, no jest/vitest. Don't claim "tests pass" without writing them first. `npm run smoke:db` is the only built-in check — it applies registry migrations against a throwaway DB.
- The README's command list omits a few `tsx` scripts: `seed:profiles`, `seed:workflows`, `import:repo`, `smoke:db`. See `scripts/` and `package.json`.
- `src/lib/agents/` (drivers: `echo` default, `openrouter`, `coder`) and `src/lib/workflows/` (`.mind/workflow.yml` runner) aren't broken out in the README's Layout section.
- Wiping `.css-data/` invalidates every OIDC dynamic-client registration; bridge identity rows in SQLite go stale and you must re-authorize via `/connect`.
- `.git-data/repos/{owner}/{name}.git/hooks/post-receive` bakes `BRIDGE_PUBLIC_URL` at *creation* time. Changing the env var later means re-creating the repo or `sed`-ing the hook file.

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
