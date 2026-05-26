# Session notes — 2026-05-26 — agents pipeline + pod publish

End-to-end exercise of the coder → PR → Pages-publish loop on the live
Hetzner alpha (`codespaces.duckdns.org`). What worked, what broke, and
what the bridge logs now expose. Shipped 6 commits (v0.1.11 → v0.1.16).

## What was demonstrated

Two repos published from agent-generated code under `testUser`:
- `https://codespaces-pod.duckdns.org/testuser/public/sites/neon-snake/index.html`
- `https://codespaces-pod.duckdns.org/testuser/public/sites/neon-breakout/index.html`

Both were produced from a single English issue body. The coder driver
spawned `mind-codespaces/coder:latest`, opencode generated the file,
the bridge committed to `agent/issue-{n}` and opened a PR, then a
human-side push moved the content onto `main` for Pages to consume.

## Bugs fixed end-to-end

1. **`quotas.ts` SQL bug** — `countRunsForOwnerPast24h` queried
   `workflow_runs.created_at`, but migration `003_workflow_runs.sql`
   names the column `started_at`. The uncaught SQL error surfaced as
   `HTTP 500` with empty body on every `POST /api/agents/dispatch`.
   Fixed in v0.1.11 (`4c333b7`).

2. **Bootstrap gate on `OPENROUTER_API_KEY`** —
   `src/lib/agents/bootstrap.ts:35` only registered the BYOK-aware
   `coder` driver when the bridge-wide env key was set, so deployments
   that relied on per-user `/profile/ai-providers` keys silently had
   `driver coder not found` returned by every dispatch. The driver is
   now registered unconditionally; the env key remains as a fallback
   for owners who haven't configured BYOK. Fixed in v0.1.11.

3. **`parseEvent` missing `issue.commented`** — the `coder` role's
   trigger set includes `issue.commented`, but the manual dispatch
   route's parser rejected that event type with `400 unknown event`.
   Fixed in v0.1.11.

4. **Default model retired upstream** — `MIND_AGENT_MODEL` defaulted
   to `anthropic/claude-3.5-sonnet`, which OpenRouter now returns
   `404 No endpoints found for anthropic/claude-3.5-sonnet` for.
   Default swapped to `qwen/qwen3-coder:free` (free, tool-use
   capable) in v0.1.13. Curated dropdown in
   `src/lib/ai-providers/providers.ts` also reworked: dropped the
   broken `claude-3.5-sonnet` + `gemini-2.0-flash-exp:free` entries,
   added current `:free` options that actually respond
   (`deepseek-v4-flash`, `llama-3.3-70b`, `glm-4.5-air`).

5. **Agent-logs not writable in the bridge container** — the v0.1.12
   `bridge_agent_logs` named volume mounted at a path the image
   hadn't pre-created, so Docker created it as root-owned. The
   non-root bridge process's `createWriteStream` then silently
   failed on first write — `mkdir` succeeded (recursive, no-ops on
   existing dir), but per-run log files stayed 0 bytes and the UI
   sat on "waiting for driver to start producing output" for entire
   runs even though the container was making real progress. Fixed
   in v0.1.14 (image pre-creates the dir under `node:node`) and
   v0.1.15 (converted to a bind mount documented in
   `infra/prod/README.md` for an unambiguous operator chown step).

6. **`parsePorcelain` off-by-one** — `status.stdout.trim()` stripped
   the leading space of ` M index.html`, leaving `M index.html`,
   and `slice(3)` then landed at `ndex.html` — every PR's "Changed
   files" list reported a mangled basename. The fix uses
   `trimEnd()` so leading whitespace (which is significant per the
   porcelain spec) survives. Caught by a regression test that runs
   `parsePorcelain` against real `git status --porcelain -uall`
   output. Shipped in v0.1.16.

7. **Merge endpoint refused fresh repos** — `POST /pulls/{n}/merge`
   errored `pathspec 'main' did not match any file(s)` on repos
   whose only commit was the agent's first commit, because there
   was no `main` to merge into. `mergeBranches` now seeds the
   target ref from the source SHA when the target ref is missing,
   so the post-receive hook still fires and the publisher chain
   triggers. Two regression tests cover the happy path and the
   missing-source error case. Shipped in v0.1.16.

## OIDC refresh-token investigation

`needs to reauthorize via /connect (refresh token failed)` was the
single most disruptive error in this session. Every operation that
writes to the pod (publisher, `writeIssueToPod`, `writeRepoMetadata`,
`pages.PUT`) failed silently with this message between any two
demos, and the only known recovery was to disconnect + reconnect
testUser in the browser.

### Original hypothesis (wrong)

"Inrupt SDK rotates refresh tokens but our IStorage adapter doesn't
persist the rotation — second use of the consumed token gets rejected
by CSS." This matched the symptom (one success then permanent
failure) but is **not** what the logs show.

### What v0.1.16's instrumentation actually reveals

`oidc.refresh.{rotated,ok,failed}` structured log lines now expose
the SDK's behavior in detail. Observations from real prod runs:

- Successful refresh — `oidc.refresh.rotated` fires (proving the SDK
  saw a refresh-token field in the CSS response) and then
  `oidc.refresh.ok` with `rotationsDuringCall: 1` and
  `mode: "delegated"` on the publisher.
- **CSS returns the same token value on every refresh.** Two
  consecutive publishes a few seconds apart logged the same
  `tokenFingerprint: "tH95…zFBB"`. So this CSS instance is **not
  implementing OAuth refresh-token rotation** — there is no token
  family to invalidate, and our adapter isn't dropping anything.
- Failed refresh — `oidc.refresh.failed` with
  `rotationsDuringCall: 0`. CSS rejects the request before any token
  field is returned. The Inrupt SDK swallows the underlying error
  (no `ERROR` event reaches us), so the failure stays opaque.

### Open question

What kills the session between snake's successful publish and
breakout's first failed publish? The token didn't change. The
session row didn't change. Yet CSS started rejecting. **Leading
suspect: the bridge container restart from a v0.1.13 deploy that
landed between those two events.** Every successful publish today
happened *without* an intervening deploy; every cross-deploy
sequence failed. The Inrupt SDK keeps in-memory state (DPoP nonce,
clock-skew tracking) per session that doesn't survive process
restart, and CSS might reject a refresh whose presented DPoP nonce
doesn't match what it remembers.

### Next investigation step

Add `cid`-tagged logs around the `client.refresh()` call inside the
SDK by either (a) shimming the SDK's `refresh` method, or (b)
intercepting the HTTP request that goes to CSS's `/token` endpoint
to capture the exact response body on failure. Once we have CSS's
actual rejection reason (`invalid_grant`, `invalid_dpop_proof`,
etc.), the fix follows directly.

## Other findings worth carrying forward

- **`openai/gpt-oss-120b:free` is the only reliable free model on
  OpenRouter for opencode's tool-call stream.** Tested in this
  session: `qwen/qwen3-coder:free` and `deepseek/deepseek-v4-flash:free`
  both hung silently for the full 600s `MIND_CODER_TIMEOUT` after the
  initial `> build · <model>` line. `gpt-oss-120b:free` reliably
  completed in 60-100s for both the build-from-scratch and
  iterate-existing-file scenarios.
- **Free OpenRouter models hallucinate success.** Run #12 of the
  concurrent batch claimed "All changes are committed on a new branch
  and opened as a PR" but wrote zero files. The bridge correctly
  caught this via the "no code changes" branch in `coder.ts` so no
  bogus PR shipped — but the model's own summary text was
  confidently wrong. Worth keeping a per-run sanity check that
  cross-references the model's claimed actions with the file
  observations.
- **Bridge restart mid-run orphans `agent_runs` rows.** Run #5 in
  this session was `running` for 9+ minutes before the v0.1.13
  deploy rolled the bridge container. The bridge's
  `finishAgentRun` never fired because the bridge was already dead
  when the docker child container finished, so the row stayed
  `running` forever. Needs a startup reaper that scans for
  `agent_runs WHERE status='running' AND created_at < now()-15min`
  and marks them `error`.
- **Concurrent agent runs against an empty repo are useful but
  expensive.** Filing 4 issues in parallel produced 1 success
  (build from scratch), 1 smart refusal ("no index.html to
  extend"), 1 OpenRouter 502 (`unexpected tokens remaining in
  message header`), and 1 silent hallucination — all four spent
  the same opencode boot time. The natural iteration shape is:
  wait for the first PR to land on `main`, then file followups.

## Operator gotchas baked into the session

- **Empty-commit probes can destroy a working tree** if the local
  clone was done with `--no-checkout` and never had files
  materialized. Running `git commit --allow-empty` against a
  checkout-less workdir silently produced "delete mode 100644"
  commits that wiped the published artifact. The recovery used
  `git checkout <sha> -- .` + a fresh forward commit to restore.
  Worth adding to the operator runbook.
- **OpenRouter `:free` model identifiers rotate quickly.** Models
  in `providers.ts`'s curated list went stale within weeks (the
  one in the user's `.env.local` from 2026-05-25 was already
  returning 404 today). A `npm run smoke:models` script that pings
  `GET /api/v1/models?supported_parameters=tools` and flags
  removed IDs would catch this before users notice.

## Commits + tags shipped

| Commit | Tag | Summary |
|---|---|---|
| `4c333b7` | v0.1.11 | BYOK-driven coder dispatch (quotas SQL, bootstrap gate, parseEvent) |
| `68a27b4` | v0.1.12 | Writable agent-logs named volume |
| `bd3cee2` | v0.1.13 | Default to `qwen/qwen3-coder:free`, retire `claude-3.5-sonnet` |
| `e66e3e9` | v0.1.14 | Chown agent-logs volume mount point in bridge image |
| `23e52a0` | v0.1.15 | Convert agent-logs to bind mount + documented host chown |
| `8c3a9e5` | (in v0.1.16) | Empty-target merge + parsePorcelain off-by-one + carrying parallel `coder.ts` work |
| `a0d2bd5` | v0.1.16 | OIDC refresh instrumentation |

## Follow-ups queued

- Root-cause the OIDC `needs-reauth` triggered by bridge restarts.
  Hypothesis: SDK in-memory DPoP nonce / clock-skew state lost.
- Startup reaper for orphaned `agent_runs` rows.
- Per-run sanity check that cross-references the model's claimed
  actions with file observations.
- `npm run smoke:models` to flag stale model IDs in
  `providers.ts`'s curated lists.
- `MIND_ENABLE_ENGINEER_AGENT` env var in `docker-compose.yml:166`
  references code that no longer exists (parallel session already
  removed it from `src/lib/env.ts`); the env var line should go too.
