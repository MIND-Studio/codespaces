# Mind Codespaces — vision, architecture, verdict

A standalone-readable account of what `codespaces` is, why it exists,
how it's shaped, and an honest read on whether it's worth turning into a
product. Replaces the original milestone-centric PRD now that the milestone
list is itself an artefact — see [`CHANGELOG.md`](./CHANGELOG.md) for the
iteration-by-iteration record and [`PRODUCTION-READINESS.md`](./PRODUCTION-READINESS.md)
for what's still open.

## TL;DR

A **Git Smart HTTP bridge** that sits between `git push` and a **Solid Pod**,
plus a **workflow runner** that can build the pushed source in a sandboxed
Docker container before publishing the output to the pod as a static site,
plus an **agents module** that responds to issue events via a single
conversational **`coder`** role (it decides per-run whether to implement or ask;
the earlier triager/scribe/engineer split was collapsed into it in v0.6.1).
Identity is via Solid-OIDC delegation — the bridge acts on the user's pod with
the user's permissions.

Runs end-to-end locally; runs in production behind Caddy on a Hetzner CX33;
crosses from "closed beta" toward "managed multi-user" per the audit. About
~22 000 lines of TypeScript / React across 140-odd source files.

## The thesis

**Your pod is your platform.** The user's Solid Pod holds their WebID
(identity), their issues as Turtle, their repository metadata as Turtle, and
the published artifact (the static site). The bridge is replaceable plumbing.

This is the same idea `mind-market-v0` explores from a different angle. Mind
Codespaces is the developer-tooling test of it: if a pod can host a working
"GitHub Pages + issues + CI" surface, the thesis is more than a slide.

## The model in one sentence

A developer creates a repo on the bridge, `git push`es their source to a
configured branch, an optional `.mind/workflow.yml` builds it inside an
ephemeral container, and a static copy lands at a Solid container the
developer owns; `git clone` and `git fetch` work normally over HTTP because
the bridge delegates to the system `git http-backend`.

## The asymmetry between the bridge and the pod (the load-bearing design choice)

- **The bridge** holds bare Git repositories on disk, translates protocols,
  runs workflow containers, and orchestrates agents. It is *not* the source
  of truth for the published site or the user's identity. If the bridge is
  replaced, the pod and its published site survive.
- **The pod** holds the WebID, the published artifact, the repo metadata
  (`solidgit:Repository` Turtle), and issues/comments. The pod is what the
  user owns; everything else can be reconstructed from a fresh `git push`.

Compare GitHub Pages, where both the repository and the published site live
on platform-owned infrastructure. Here, the artefact's canonical home is the
pod.

## Architecture

```
   ┌──────────────┐                                       ┌──────────────────┐
   │  git client  │                                       │   Solid Pod      │
   └──────┬───────┘                                       │   (CSS at :3011) │
          │                                               │  alice/          │
          │ Git Smart HTTP  (push-token gated)            │   ├── profile/   │
          │                                               │   ├── codespaces/│
          ▼                                               │   │    {repo}/   │
   ┌────────────────────────────────────────────┐         │   │    ├ index.ttl
   │  Mind Codespaces bridge (Next.js)          │  spawn  │   │    └ issues/ │
   │  :3010 (in prod: behind Caddy on :443)     │ git http│   │              │
   │                                            │ -backend│   └── public/    │
   │  ┌──────────────────────────────────────┐  │────────▶│       sites/     │
   │  │ Git Smart HTTP route + CGI           │  │         │         {repo}/  │
   │  ├──────────────────────────────────────┤  │         │         index.html
   │  │ Workflow runner (auto: docker│native)│  │         │                  │
   │  │   native:  sh -c                     │  │         └────────▲─────────┘
   │  │   docker:  node:22-alpine ephemeral, │  │                  │
   │  │            --network=none + Verdaccio│  │  authenticated   │
   │  ├──────────────────────────────────────┤  │  PUT (delegated  │
   │  │ Pages publisher                      │  │  refresh token,  │
   │  │   checkout → walk → PUT → prune      │──┼──or seeded creds)┘
   │  │   publish-lock + reconciler          │  │
   │  ├──────────────────────────────────────┤  │
   │  │ Agents dispatch                      │  │
   │  │   echo │ openrouter │ coder (opt-in) │  │
   │  ├──────────────────────────────────────┤  │
   │  │ Session auth · CSRF · rate limit ·   │  │
   │  │ CORS allowlist · response size cap   │  │
   │  ├──────────────────────────────────────┤  │
   │  │ Observability                        │  │
   │  │   NDJSON log + correlation IDs       │  │
   │  │   /api/metrics (Prometheus, bearer)  │  │
   │  ├──────────────────────────────────────┤  │
   │  │ Registry (SQLite, 13 migrations)     │  │
   │  │   repos · pages_configs · push_tokens│  │
   │  │   identities · identity_storage      │  │
   │  │   issues · pulls · workflow_runs     │  │
   │  │   agent_runs · users · ai_providers  │  │
   │  └──────────────────────────────────────┘  │
   └────────────────────────────────────────────┘
         │
         │ (prod only) docker API via socket-proxy sidecar — bridge never
         │ sees /var/run/docker.sock directly
         ▼
   docker daemon (host) — runs workflow + coder containers
```

Three durable principles:

1. **Keep Git as Git.** The bridge never reimplements Git on top of pods.
   Bare repos live on disk where Git's consistency rules (packfiles, refs,
   locks, gc) work normally. The pod holds the *output*.
2. **The bridge is replaceable.** Anyone can run another bridge against the
   same pod. A single `git push` from any client recreates the bare repo.
3. **The pod is authoritative.** Identity, repo metadata, issues, and the
   published artifact all live on the pod. If the bridge goes away, the URLs
   survive.

## What's in (today)

- **Git Smart HTTP** bridge with `git http-backend` CGI delegation. Push
  tokens (HTTP Basic) gate every push and every clone of a private repo.
- **Mind Pages publisher** — walks the source path (forbidden-list applied,
  symlinks skipped, 50 MB per-file cap), `PUT`s files with the right MIME,
  re-asserts public-read ACL, prunes stale files, records
  `last_published_sha`. A reconciler boots from `instrumentation.ts` and
  catches missed publishes every 5 minutes.
- **Pod-side repo metadata** — `solidgit:Repository` Turtle written on every
  repo or Pages-config change.
- **Workflow runner** for `.mind/workflow.yml` — native + Docker, auto-detected.
  Docker mode defaults to `--network=none` with optional Verdaccio mirror;
  `--read-only --cap-drop ALL --pids-limit=512 --ulimit nofile=1024:1024`;
  log-cap; stuck-run reaper at boot.
- **Agents** — `triager`, `engineer`, `scribe` roles; `echo`/`openrouter`/`coder`
  driver ladder; `coder` is opt-in via `MIND_ENABLE_ENGINEER_AGENT=1`.
- **Issues + comments** — pod-native Turtle + SQLite index. Pull requests
  in SQLite only (Turtle for PRs is pending).
- **Auth** — session cookie (HMAC-signed, 32-byte key), readable `mc-csrf`
  mirror for double-submit CSRF, `requireSession` / `requireOwner` on every
  mutating route. Solid-OIDC delegation via `/connect` with refresh tokens
  AES-256-GCM-encrypted at rest. Password login against seeded CSS users at
  `/login` (dev convenience).
- **Multi-user** — `users` table, `/signup` (gated on `BRIDGE_ENABLE_SIGNUP=1`),
  per-owner quotas (repos / tokens / runs-per-day / disk-per-repo).
- **BYOK AI** — `/profile/ai-providers` lets users bring OpenRouter / OpenAI /
  Anthropic / Google keys for the agents that act on their behalf.
- **Dashboard + repo detail + code browser + runs list + people directory**.
  Editorial UI (serif display + monospace eyebrows) with light/dark/neo themes.
- **Observability** — NDJSON logger with WebID scrubbing and correlation IDs;
  Prometheus metrics endpoint; real `/api/health`; cheap `/api/livez` for
  liveness probes.
- **Production deployment** — `infra/prod/`: Dockerfile, compose (caddy +
  bridge + css + socket-proxy + verdaccio), Caddyfile, env example, bootstrap
  script, pin-image-digests helper. Live on Hetzner CX33 at
  `codespaces.duckdns.org`. See [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## What's deliberately out / next

The list of remaining gaps is the OPEN section of
[`PRODUCTION-READINESS.md`](./PRODUCTION-READINESS.md). The strategic
hold-outs:

- **No deletion API.** Repos can be created but not destroyed via the API
  (P2).
- **Pod-canonical reconciler for issues/comments** — today every write goes to
  SQLite first and the pod mirror is best-effort. A restore from an old DB
  backup silently orphans pod-side issues (§3.7).
- **No multi-host federation.** OIDC issuer allowlist is per-deployment;
  cross-host pods would need it parameterised.
- **No pull-request Turtle on the pod.** PRs are SQLite-only — they aren't
  portable across bridges yet.
- **Agent budgets** — no per-repo / per-owner / per-day token cap on agent
  calls. Combined with the engineer role's blast radius (§6 of
  PRODUCTION-READINESS), this is the gate on enabling `coder` for anyone you
  don't trust.
- **Tests** — 8 unit tests pass; integration tests (Smart HTTP round-trip,
  live-CSS publish, OIDC, concurrent push, reconciler) are still to do.

## What was learned

Carry-forward observations from the build:

- **WebVM is the wrong shape for a server-side runner.** CheerpX is
  proprietary and browser-only. WASM more broadly still can't credibly
  replace Docker for full Node build chains in 2026. Per-build Docker
  remains the boring-correct answer for arbitrary `npm` workflows.
  Wasmer Edge.js is worth a 1-day spike in 2027, not now.
- **Streaming `git http-backend` through Next.js 16 Route Handlers works
  first try** once the spawn type signature is right (`env: NodeJS.ProcessEnv`
  so the overload resolves to `ChildProcessWithoutNullStreams`; don't set
  `stdio: ["pipe","pipe","pipe"]` explicitly — it breaks inference).
- **Public-read ACL has to be re-asserted on every publish.** Setting it
  once at pod-setup time is fragile to admin tools or other bridges narrowing
  it later. The cost is one extra small PATCH per publish.
- **Tailwind v4's preflight strips list-style and font-weight.** Both have to
  be restored explicitly in `.markdown-body` styles to render READMEs.
- **Turbopack's CSS hot-reload caches stale bundles.** `rm -rf .next` is the
  only reliable way to pick up CSS changes during dev. Documented in
  `AGENTS.md` after losing 15 minutes to it.
- **YAML plain-scalar colons are a footgun.** `sh -c 'echo expected: 42; ...'`
  parses as a mapping; wrap the whole scalar in double quotes.
- **The publisher's prune-on-republish had three bugs in a row.** Turtle
  parsing with `[^;.]+?` broke on dots inside filenames; CSS returns relative
  URIs; the prune walk needed proper container recursion. Rewriting the
  parser as an imperative `<URI>`-token scanner between `ldp:contains` and
  `;`/`.` made it bulletproof. **Still the most fragile module in the
  codebase** and the strongest candidate for a real integration test.
- **Two-column repo detail (main + sidebar)** turned out to be the highest-
  impact UI change of the whole prototype. The page is a dashboard, not an
  editorial article.
- **Editorial UI (serif display + monospace eyebrows + restrained palette)**
  survived three iteration rounds without redesign. The visual language is
  right for a dashboard that sells a thesis. The neo theme is for developer
  hours, not marketing.

## Would it be a good Mind product?

The honest answer: **a strong wedge, not a standalone product yet.**

**Where it's compelling.** It proves the Mind thesis end-to-end — `git push`
→ build → publish → URL on your pod, with the bridge replaceable. The
workflow runner is non-trivial (real Docker isolation, real auto-detect,
honest sandbox-vs-network trade-off). The agentic-coding-course framing — small,
focused milestones, working end-to-end after each — was the right shape and
the prototype's source is readable.

**Where it's thin.** The audience intersection (Solid users ∩ self-hosted
Git ∩ not-GitHub) is small. The non-Solid competition (Cloudflare Pages,
Vercel, Netlify, Fleek) dominates "free static hosting + git push" on UX,
edges, and team features. The collaboration story is shallow — pulls without
pod Turtle, no notifications, no review queues. The two-sided operational
cost (someone runs the bridge AND someone hosts the pod) needs the pod-host
market to mature.

**What it would take to ship as a product**, in rough order of cost:

1. **Pull-request Turtle on the pod** so PRs are portable. ~2 days.
2. **Agent budgets + branch-target restrictions** so the engineer role is
   safe to enable for external users. ~3 days.
3. **Pod-canonical reconciler for issues/comments** so restore-from-backup
   doesn't orphan pod state. ~3 days.
4. **Integration test suite** (Smart HTTP round-trip, live-CSS publish,
   OIDC) so refactors stop being scary. ~1 week.
5. **Hosted pod offering or tight partnership.** The BYO-pod model only
   works for a small expert audience. Quarter-scale work.
6. **A reason for non-ideologues to use it** — speed, price, integration
   with other Mind products, a feature competitors can't match. Open-ended.

That's ~1 month of fixes from a credible alpha to a credible private beta;
the productisation question (items 5–6) is what determines whether to spend
the next quarter on it.

### Verdict

The prototype's highest-value uses are:

1. **As a building block in the larger Mind ecosystem story.** Paired with
   `mind-market-v0` and any future pod-native products, it makes "your pod
   is your platform" a category, not a slogan.
2. **As an educational asset for the agentic-coding course.** Small,
   end-to-end, exercises every layer (Git, HTTP, Solid OIDC, Docker, SQLite,
   React, Tailwind), iterative milestone structure worked.
3. **As a proof that the Solid stack can host real developer tooling**,
   which is a non-obvious result worth knowing even if this specific product
   never ships.

It is probably **not** a standalone product. If forced to choose: invest the
next quarter in items 1 and 2 (course + ecosystem narrative), not 5–6
(productisation), unless the product question gets a clear "yes."

## Privacy and ownership guarantees specific to the current build

Enforced in code:

1. The bridge holds only the bookkeeping it needs: repository names, owner
   identifiers, Pages configuration, push tokens (sha256 at rest), issues /
   pulls / workflow / agent rows. No third-party SaaS in the data path.
2. The *published artifact* lives in the user's pod. Replacing the bridge
   does not destroy any published site.
3. The bridge does not run user-provided build commands without isolation
   when Docker is available (the default in prod). Native-shell fallback is
   for dev only and is logged on every run.
4. The publisher refuses to upload anything in the forbidden list (`.git/`,
   `.env*`, `node_modules/`, `.aws`, `.ssh`, `id_*`, `*.pem`, `*.key`,
   `.netrc`, `.npmrc`, …), skips symlinks via lstat, and caps files at
   50 MB.
5. Refresh tokens stored in `identity_storage` are AES-256-GCM-encrypted
   with `IDENTITY_ENCRYPTION_KEY`. Session cookies are HMAC-signed with
   `BRIDGE_SESSION_SECRET`. Post-receive hook callbacks are HMAC-signed with
   `BRIDGE_HOOK_SECRET`. The bridge refuses to start in production without
   any of these.
6. The bridge's registry schema is in `src/lib/registry/migrations/`; the
   disk layout is documented in `README.md`. The prototype is open to
   inspection.
