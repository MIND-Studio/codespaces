# Session notes — 2026-05-30 — codex agent backend (PoC)

Added a second issue-driven agent backend — a `codex` driver that runs
OpenAI's `codex exec` — alongside the existing opencode `coder` driver.
Built and verified end-to-end (host runtime) on a dev Mac. **The
strategic question of whether this should ship is still open — see the
last section.**

## What was built

A sibling of `coder` that reuses the same clone → branch-resume →
run-agent → inspect → commit/PR (or `.mind/agent-comment.md` ASK) shape;
only the agent invocation differs.

- **New:** `src/lib/agents/drivers/codex.ts`,
  `infra/codex/{Dockerfile,entrypoint.sh}`.
- **Edited:** `src/lib/agents/bootstrap.ts` (register `codexDriver`),
  `src/lib/agents/dispatch.ts` (optional `{driver}` override),
  `src/app/api/agents/dispatch/route.ts` (validated `driver` field),
  and the two auto-dispatch sites (`issues/route.ts`,
  `issues/[number]/comments/route.ts`) read `MIND_ISSUE_DRIVER`.
- **Deliberately NOT touched:** `coder.ts`, `env.ts` (both carried
  uncommitted parallel-session work at the time).

### Two runtimes (`MIND_CODEX_RUNTIME` = `host` | `docker` | `auto`)

- **host** (default, dev): runs `codex exec` directly on the bridge host
  using the operator's `~/.codex/auth.json` — a **ChatGPT subscription**
  login (no API key, no per-token cost). `-s workspace-write` keeps writes
  scoped to the checkout. Device-bound.
- **docker** (prod seam): hardened container `mind-codespaces/codex:latest`
  (built from `infra/codex/`), authed by `OPENAI_API_KEY` (entrypoint runs
  `codex login --with-api-key`). Container is the sandbox, so codex runs
  with `--dangerously-bypass-approvals-and-sandbox`. The driver errors
  fast if docker runtime is selected with no `OPENAI_API_KEY`.
- Other env: `MIND_CODEX_IMAGE`, `MIND_CODEX_MODEL` (optional; omit to use
  codex's configured default), `MIND_CODEX_TIMEOUT` (600s),
  `MIND_CODEX_NETWORK`. Reuses `MIND_CODER_WORKROOT` / `GIT_DATA_DIR`.

### How it's invoked

Not auto-triggered as its own role (no double-fire by *adding* a role).
Instead the manual dispatch endpoint takes an optional driver override:

```
POST /api/agents/dispatch
{ "type":"issue.created", "repoOwner":"alice", "repoName":"…",
  "issueNumber":1, "driver":"codex" }
```

For the *automatic* issue→agent path, `MIND_ISSUE_DRIVER=codex` makes the
existing `coder` role run through the codex driver instead of opencode.

## Verified (host runtime, dev Mac)

- `npx tsc --noEmit` clean; `vitest run` = 21/21 pass.
- Implement path: codex edited `index.html` and the driver opened a PR
  (`agent/issue-N → main`). Two clean runs: the welcome-`<h2>` (PR #1) and
  the footer (PR #2, run #72, 18.2s on the subscription).
- ASK path: a question-style issue produced an issue comment by
  `mind:agent:codex`, no PR.
- Prod image builds and contains git 2.39.5 + ripgrep 13.0.0 + codex
  0.135.0. **A full *authed docker run* was NOT verifiable** on this
  device — it has ChatGPT-subscription auth, not an `OPENAI_API_KEY`.

## The race we hit (and the partial fix)

Creating/commenting an issue **auto-fires the `coder` role** (issues +
comments routes). So separately hand-firing `driver:"codex"` on the same
fresh issue runs *two* agents against one `agent/issue-N` branch; whoever
pushes second gets a non-fast-forward rejection (`git push failed
(exit 1)`). Observed live: codex (run #72, ~18s) won; the parallel gemini
coder (run #71, opencode-in-docker) lost the push.

Partial mitigation shipped: `MIND_ISSUE_DRIVER` makes the *auto* path use a
single backend. It does **not** stop a deliberate concurrent hand-fire, and
it's a global, restart-required env — see the open question.

## Gotchas worth carrying forward

- **`codex exec` hangs on an open non-TTY stdin** (`Reading additional
  input from stdin…`). Close stdin: `< /dev/null`, or Node
  `spawn(stdio:["ignore",…])` (what the driver's `sh` helper does). Looks
  like a slow model; it isn't.
- **The bridge mutating API wants header `X-CSRF-Token`** — the README's
  `x-mc-csrf` examples are wrong and return 403. `POST /api/auth/login`
  also needs an `Origin: http://localhost:3010` header. The `mc-session`
  cookie is HttpOnly (curl stores it with a `#HttpOnly_` prefix).
- codex with subscription auth defaulted to model `gpt-5.5`; container
  API-key auth uses `codex login --with-api-key` writing
  `$CODEX_HOME/auth.json` (entrypoint points CODEX_HOME/HOME at the tmpfs).

## OPEN STRATEGIC QUESTION — does the codex backend make sense here? (UNDECIDED)

The PoC works, but whether to keep it is unresolved. The honest tension:

- The compelling *free* host mode runs on **one operator's personal
  ChatGPT login** — fine for solo dev, but it cannot back a **multi-tenant**
  bridge (one person's consumer creds for every user; ToS; not
  privacy-first). In prod it collapses to docker + `OPENAI_API_KEY`…
- …at which point it's just **another paid cloud key**, and **opencode
  already supports OpenAI/Anthropic/Gemini via BYOK**. So as a *cloud*
  backend, codex largely **duplicates** `coder`.
- That duplication is the *root* of the selection/race complexity above:
  two backends doing one job is why we suddenly need driver-selection +
  locks at all.

Three candidate paths (pick one before building more selection machinery):

1. **Dev-only.** Keep codex as a manual/dogfooding backend (better harness
   than free-OpenRouter opencode, free on the subscription). Do **not**
   make it an auto co-backend; *drop* `MIND_ISSUE_DRIVER` and skip the
   per-issue lock — removing the second auto-backend removes the race by
   construction.
2. **Local-model pivot.** Repoint the same driver at a *local* model via
   codex's `--oss` / `--local-provider {ollama,lmstudio}`. This is the only
   version that's actually on-strategy (local-first, nothing leaves the
   machine) and a real differentiator vs. opencode-via-cloud.
3. **Drop it.** Conclude opencode + BYOK already covers cloud backends and
   the harness-quality gap isn't worth a second code path.

Deciding lever: is the interest in codex about **a better/cheaper dev loop
for the operator** (→ path 1) or **a better backend for users** (→ path 2)?
The cloud-subscription form is not a product backend.

## Follow-ups (gated on the decision above)

- If keeping as an auto backend: replace the global `MIND_ISSUE_DRIVER`
  env with a persisted per-repo (or per-user) backend choice + a per-issue
  run lock in the dispatcher (refuse a second `running` row for one issue).
- If path 2: wire `--oss`/`--local-provider` + a local model into the
  driver and image; drop the OpenAI auth path.
- Either way: update the README "Agents" section (currently lists only
  echo/openrouter/coder) once the decision lands.
- Full authed `docker` run of the codex image remains unverified (needs an
  `OPENAI_API_KEY` on a test host).
