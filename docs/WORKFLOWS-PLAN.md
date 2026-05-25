# Workflows — design rationale

Captures the design space for "git actions / CI" on Mind Codespaces, the
tradeoffs around WASM as an execution sandbox, and the tiered path that
shipped. Steps 1, 2a, and most of 2b are in production; Steps 3 and 4 are
explicitly future work. Sections marked ✓ describe shipped behaviour; the
rest is forward-looking.

## The motivating use case

> "Push my Vite/Astro/Hugo source. Build runs server-side. Built output
> auto-deploys to my Solid Pod via Mind Pages."

This is the autodeploy story. The current Mind Pages publisher only knows
how to copy files verbatim — it can't build. To go beyond static-HTML
repos, the bridge needs a way to run user-supplied commands between
"branch checked out" and "files published".

## Honest take on WASM

WASM keeps coming up because it sounds like the right shape for
"sandboxed code execution". Worth being precise about where it actually
fits.

### Where WASM is a great fit

- **One known binary, narrow scope.** Embed wasmtime in the bridge; load a
  single WASM module like `pandoc.wasm`, `tailwindcss-cli.wasm`,
  `markdown-it.wasm`. Fast cold start, real sandbox, deterministic. Ideal
  for "render markdown to HTML", "minify CSS", "transform Asciidoc".
- **Server-controlled extensions.** A plugin model where the bridge knows
  the list of trusted WASM transforms and the workflow.yml picks from a
  menu.

### Where WASM is *not* the right primitive

- **General `npm install && npm run build`.** Most build chains assume
  Node, posix-ish fs, child processes, dynamic module loading, network
  egress. WASI is getting there (component model, Preview 2) but is still
  bleeding-edge. You'd end up either reinventing significant runtime
  plumbing or adopting a non-self-hostable platform.
- **Stackblitz-class browser-Node (WebContainers).** Genuinely impressive
  — full Node toolchain in the browser via virtual fs + emscripten — but
  not open source. Can't self-host.
- **Anything that needs to fire when no human is online.** Browser WASM
  needs an open tab to execute. Autodeploy by definition fires from a
  push, not from a user click. So browser WASM is "preview/playground",
  not "CI".

### Where Docker is the boring-and-correct answer

For "run any user-supplied build command with strong isolation",
per-build Docker containers with seccomp + cgroups + no network egress
is the shape every mature CI system landed on for good reasons. Cold
start is seconds, ops cost is real, but security and toolchain coverage
are unmatched. Worth doing once the prototype graduates past single-user.

## Design space (summary)

| Option | Sandbox | Toolchain coverage | Cold start | Fit for autodeploy |
|---|---|---|---|---|
| **A — Native, no sandbox** | none (trust the operator) | full | ~ms | great for single-user prototype |
| **B — Native, OS-level (Docker / Firecracker / nsjail)** | strong | full | seconds | the boring-correct multi-user answer |
| **C — Server WASM (wasmtime, embedded)** | very strong | narrow (one binary) | ms | great for known transforms; bad for `npm install` |
| **D — Browser WASM (WebContainers, zen-fs, …)** | strong-but-local | medium (Node-in-browser) | seconds | useless for autodeploy; great for preview |

## Recommended tiered path

The schema we choose for `.mind/workflow.yml` is reusable across all
four. Build them in this order:

### Step 1 — Native, sandbox-free workflow runner ✓ shipped

- Repo ships `.mind/workflow.yml` declaring a `run:` array and (optional)
  `publish:` directory.
- Post-receive hook detects the file, runs the commands in the existing
  Pages-publisher temp checkout (cwd = repo root), with a hard timeout
  and combined stdout/stderr capture.
- If `publish:` is set AND the repo's Mind Pages config is enabled, the
  existing Pages publisher uploads the named directory to the configured
  pod container.
- Status (queued/running/success/failed/error) + exit code + truncated
  log tail persisted in `workflow_runs`.
- "Latest build" panel on `/repos/{o}/{r}`; full history at `/runs`; manual
  rerun button.

Native mode is now the fallback when Docker isn't reachable; force with
`MIND_RUNNER=native`. Threat model: same as before (single-tenant; the
operator pushes their own repos; no sandbox beyond timeout). The runner
logs `[runner: native]` on every run so the absence of sandbox is visible.

### Step 2 — Containerized hardening

**Step 2a (shipped 2026-05-23): minimal containerization. ✓**
Single ephemeral `docker run` per workflow — all `run:` commands chained
with `&&` inside one shell invocation so `node_modules` and tool caches
carry across steps. The host bind-mounts the temp checkout as `/work`;
the container runs as the host UID so the publish step (which runs back
on the host after the container exits) can read the output. Resource
caps (`--memory`, `--cpus`) and wallclock timeout enforced by killing
the host-side `docker` process. Auto-detected at startup; falls back to
native if Docker isn't available.

**Step 2b (mostly shipped, parts open):** the hardening that justifies
multi-tenant hosting.

- ✓ **No network egress by default.** `--network=${MIND_WORKFLOW_NETWORK}`
  defaults to `none` (`src/lib/workflows/docker.ts`). The prod compose
  provisions a `mind-workflows` user-defined network with a Verdaccio
  sidecar; workflow containers join only that network and get
  `MIND_NPM_REGISTRY=http://verdaccio:4873/` injected as
  `npm_config_registry`. Egress is "Verdaccio only" — closes the
  "workflow can call home" hole.
- ✓ **Per-workflow image selection** via the `image:` field
  (default `node:22-alpine`).
- ✓ **cgroups / hardening** on every workflow container:
  `--read-only --tmpfs /tmp:size=512m,exec --security-opt no-new-privileges
  --cap-drop ALL --pids-limit=512 --ulimit nofile=1024:1024 --memory=2g
  --cpus=2`.
- ✓ **Log-capture cap** at `MIND_WORKFLOW_LOG_LIMIT` (default 5 MB) to
  defuse `printf` bombs.
- ✓ **Stuck-run reaper** at boot (`reapStuckRuns` in
  `src/lib/registry/runs.ts`) force-finalises orphaned `running` rows.
- _Open:_ pod-write proxy so the container holds delegated credentials
  directly (currently moot — the publish step still runs on the host
  after the container exits). Hard-fail when Docker is unavailable in
  prod (today's silent native-fallback is acceptable because the prod
  compose pins `MIND_RUNNER=docker`, but a build-time refusal would be
  safer).

### Step 3 — Server WASM for narrow builders

Embed `wasmtime` (Node has bindings) into the bridge. Ship a small library
of trusted WASM modules:

- `mind:transforms/markdown` → markdown → HTML
- `mind:transforms/highlight` → syntax highlighting
- `mind:transforms/minify-css`
- `mind:transforms/svgo`

`workflow.yml` can use them with `use:` instead of `run:`:

```yaml
use: mind:transforms/markdown
inputs: content/**/*.md
outputs: dist/
```

Faster than the container for these specific jobs, real sandbox, no
toolchain surface area. Complementary to step 2, not a replacement.

### Step 4 — Browser WASM "Preview" feature

Distinct from autodeploy. A dashboard button "Preview locally" that runs
the same `workflow.yml` in the user's browser via WebContainers (or an
open-source equivalent like `zenfs/node`). Lets devs iterate without
pushing.

Worth doing if user demand surfaces. Independent of steps 1–3.

## Workflow.yml — sketch for step 1

Intentionally narrow. Add fields only when something forces it.

```yaml
# .mind/workflow.yml — runs after a push to the default branch.

# Shell-style commands, executed in order in the repo checkout root.
# Each command runs via `sh -c "..."` so you can use && / pipes / env.
run:
  - npm ci
  - npm run build

# After `run:` finishes successfully, the named directory becomes the
# input to Mind Pages publishing (if Pages is enabled for the repo).
# If omitted: workflow runs but doesn't publish anything.
publish: dist

# Optional — fail the run if it takes longer than this. Defaults to 300s.
timeout: 600
```

Validation rules (step 1):
- `run` must be a non-empty array of non-empty strings.
- `publish` must be a relative path with no `..` and no leading `/`.
- `timeout` is an integer in seconds, 1–1800.
- All other fields are rejected (no silent unknown keys).

## Status / data model

```sql
CREATE TABLE workflow_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  ref           TEXT    NOT NULL,
  status        TEXT    NOT NULL,  -- queued | running | success | failed | error
  exit_code     INTEGER,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  log_tail      TEXT    NOT NULL DEFAULT '',  -- last ~64KB of combined stdout/stderr
  error_message TEXT
);
CREATE INDEX idx_workflow_runs_repo ON workflow_runs (repo_id, started_at DESC);
```

`status` values:
- `queued` — row created, runner hasn't started yet
- `running` — runner spawned, commands executing
- `success` — all commands exited 0, publish (if any) succeeded
- `failed` — a command exited non-zero, or publish failed
- `error` — runner crashed before reaching status=success/failed (e.g. bad YAML)

## Relationship to Mind Pages

- `pages_configs` keeps its existing meaning (target container, source
  branch). New field `sourcePath` is *overridden* by `workflow.yml`'s
  `publish:` when a workflow exists.
- No workflow.yml → Pages behavior unchanged (publish `sourcePath` as
  before).
- workflow.yml without `publish:` → workflow runs, nothing published.
- workflow.yml with `publish:` + Pages enabled → workflow runs, then
  Pages publishes the named dir.

## Out of scope for step 1

- Per-step env vars / secrets (workflow inherits the bridge process env).
- Matrix builds.
- Caching (`actions/cache` equivalent).
- Multiple workflow files per repo.
- Triggers other than push (no schedule, no manual).
- Concurrent runs for the same repo (block / queue / cancel-older policy).
- Build-output retention beyond what the pod stores.

## Open questions

1. **Logs.** Persist full logs to disk (`.workflow-logs/{run_id}.log`) so
   the SQLite `log_tail` is only an excerpt? Probably yes once runs grow
   beyond toy scale.
2. **Per-step status.** Step 1 collects one combined log. Showing
   per-step status (like GitHub Actions' green-check-per-step UI) is
   nicer but adds parsing complexity. Defer to step 2.
3. **Concurrent push handling.** If two pushes land while a build is
   running, queue or cancel-older? Step 1: just run them sequentially in
   FIFO order on a per-repo lock.
4. **Cleanup.** When does `workflow_runs` get pruned? After N rows per
   repo? Or never (manual)? Defer.

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-22 | Skip WASM entirely for step 1 | WASM doesn't reduce effort for the autodeploy goal. Embedded wasmtime helps later (step 3) but adds nothing at step 1. |
| 2026-05-22 | No sandbox at step 1 | Threat model is single-tenant operator who pushes their own repos. Adding Docker is real work and outranks the value of "first end-to-end autodeploy demo". |
| 2026-05-22 | Reuse Pages publisher | The publisher already takes (sourceDir → targetContainer). Workflow.yml just renames `sourcePath` to `publish:` semantically. |
| 2026-05-23 | WebVM/CheerpX rejected for the runner | CheerpX is proprietary and browser-only (no server embedding). WebVM itself (Apache-2.0) is just the demo shell — no headless Node host we can call into. |
| 2026-05-23 | WASM still not credible for full Node builds in 2026 | WasmEdge runs QuickJS (not Node). Wasmer Edge.js (MIT, Mar 2026) is the one promising candidate — claims headless Node v24 + npm/pnpm — but pre-1.0 and unproven on native deps (esbuild/sharp/swc). Worth a 1-day spike in 2027, not now. |
| 2026-05-23 | Step 2 = Docker, single container per workflow | One `docker run` chains all commands so `node_modules` carries across steps. Bind-mount the checkout, run as host UID so the host publisher can read the output. |
| 2026-05-23 | Auto-detect Docker, fall back to native | The prototype must keep working without Docker installed. Operator can force with `MIND_RUNNER=docker\|native`. |
| 2026-05-24 | Network default flipped from `bridge` to `none` | The Verdaccio mirror in `infra/prod/` gives `npm ci` what it needs without giving the container the public internet. Closes the workflow exfil path. |
| 2026-05-24 | Per-workflow `image:` selection | Cheap to implement once the docker driver was in place; lets a repo pin its own base image (`node:20`, `python:3.12`, …). |
| 2026-05-24 | Log capture cap (`MIND_WORKFLOW_LOG_LIMIT`, default 5 MB) | A `printf` bomb in a build could OOM the bridge. Truncate as we go; surface "[log truncated]" in the UI. |
