# Mind Codespaces — prototype summary

A standalone-readable account of what `mind-codespaces-v0` is, what was built,
how it works, what was learned along the way, and an honest assessment of
whether it would make a good Mind product. Written 2026-05-23, after the
prototype reached its planned scope.

For deeper detail see [`PRD.md`](./PRD.md) (the vision and milestones),
[`WORKFLOWS-PLAN.md`](./WORKFLOWS-PLAN.md) (the workflow runner design
space), and [`CHANGELOG.md`](./CHANGELOG.md) (iteration-by-iteration log).

---

## TL;DR

Mind Codespaces is a **Git Smart HTTP bridge** that lives between a `git
push` and a **Solid Pod**, plus a workflow runner that can build the pushed
source in a Docker container before publishing the result to the pod as a
static site. About 5,200 lines of TypeScript / React across 53 source files
and 3 seed scripts.

It works end-to-end. You can `git push`, watch a workflow run, and see the
build land at a URL on your pod — with the bridge replaceable, the pod
authoritative, and identity via WebID.

**As a Mind product:** a strong wedge for the "your pod is your platform"
thesis, a great teaching artifact for the agentic-coding course, **not** a
standalone business. The market for self-hosted Git + Solid pods is too thin
right now. Useful primarily as one piece of a bigger Mind story or as a
proof that the Solid stack can host developer tooling.

---

## What it is

A Next.js bridge on `:3010`, a Community Solid Server pod host on `:3011`,
and a SQLite registry that tracks repositories, push tokens, OIDC sessions,
and workflow runs. The user's `git` client pushes over Smart HTTP; the
bridge delegates to `git http-backend` (CGI), persists the bare repo on
disk, and on every push checks for `.mind/workflow.yml`. If present, it
runs the workflow inside an ephemeral `node:22-alpine` container, then
publishes the named output directory into a container on the user's Solid
pod via authenticated `PUT`s.

The thesis is the same one `mind-market-v0` explores from a different
angle: **the user's pod is the platform**. The bridge is a thin protocol
translator; the artifact, the identity, and the metadata all live on the
pod.

---

## What was built

### Core (shipped, MVP scope)

- **Git Smart HTTP bridge** — a Next.js Route Handler spawns `git
  http-backend` as a CGI, streams the request body in, parses CGI-style
  headers out, streams the response. Real `git clone`/`fetch`/`push` work
  against `http://localhost:3010/api/git/{owner}/{repo}.git`.
- **Bare repos on disk** at `.git-data/repos/{owner}/{repo}.git/`, with a
  `post-receive` hook installed at creation time that curls back into the
  bridge to trigger publish + workflow runs.
- **SQLite registry** with globalThis-cached handle, auto-applied
  migrations. Tables: `repos`, `pages_configs`, `push_tokens`, `identities`,
  `identity_storage`, `workflow_runs`.
- **Mind Pages publisher** — checks out the configured branch shallow into
  a temp dir, walks it (skipping `.git/`, `.env*`, `node_modules/`, etc.),
  `PUT`s every surviving file to the pod's `/public/sites/{repo}/`
  container with the right MIME type, then **prunes** anything in the
  target that wasn't in the source.
- **Public-read ACL** asserted idempotently on `/public/` so anyone can
  fetch published files.
- **Pod-side repo metadata** — every repo or Pages-config change writes a
  Turtle description (`solidgit:Repository`) to
  `{podRoot}/codespaces/{repo}/index.ttl`. Other Solid-aware tools can
  discover repositories through the pod without going through the bridge.

### Auth

- **Push tokens** — per-repo, `scp_`-prefixed, sha256 at rest, gated via
  HTTP Basic on every push (and every clone of a private repo).
- **Solid-OIDC delegation** (`/connect`) — full authorization-code flow with
  Inrupt SDK, custom SQLite `IStorage` impl, dynamic client registration.
  The publisher prefers delegated auth (acts as the pod owner via a refresh
  token) and falls back to seeded credentials only if no delegation exists.

### Workflows

- **`.mind/workflow.yml` schema** — `run:` array, optional `publish:`
  directory, optional `timeout:` seconds (1–1800, default 300). Strict
  validation; unknown keys rejected.
- **Native + Docker runners with auto-detect** — if `docker info` succeeds
  at first use, every workflow's commands run inside one ephemeral
  `node:22-alpine` container (bind-mount, host UID, 2GB / 2 CPU caps).
  Otherwise falls back to native `sh -c`. Mode logged on every run.
  Forceable with `MIND_RUNNER=docker|native`.
- **Run history + manual re-run** — every push records a row in
  `workflow_runs`. The dashboard's "Latest build" panel surfaces status,
  duration, exit code, log tail. The runs list page shows all 50 most
  recent runs with red-bordered failures and one-line failure summaries.
  A manual re-run button on the repo detail page triggers a fresh run
  without needing a new commit.

### UI

- **Editorial design language** — serif display + monospace eyebrows + a
  restrained palette (paper + ink + accent), with full dark mode via OS
  preference + a manual toggle that writes `data-theme` to `localStorage`.
- **Landing page** with a live-status tile (X repos · Y runs · last
  activity), "try these now" cards into the seeded demos, and a collapsible
  API quickstart for fresh installs.
- **Dashboard** grouped by owner (orgs first), build-status chip per card
  for repos with workflow runs, live-site path chip for Pages-live repos,
  relative timestamps.
- **Repo detail** — two-column layout at `lg+` (main: README + Latest build
  + Previous runs / sidebar: clone URL with copy button, owner facts, Pages
  config, tokens collapsed). Status hero strip summarizing build / pages /
  run count. Stacks to single column on mobile.
- **Code browser** at `/repos/{o}/{r}/tree` and `/blob/` — directory listing
  via `git ls-tree`, file viewer with line numbers via `git cat-file`.
- **Runs list + run detail** — relative timestamps, full log on the detail
  page, failures visually distinct.

### Three seeded demo repos exercising different shapes

- `alice/marked-blog` — real `npm install` + `marked` builds a multi-page
  blog from `posts/*.md`. End-to-end in 1.8s after the image is warm.
- `alice/tailwind-site` — real `npm install` + Tailwind v4.3 CLI compiles a
  styled landing page. Four shell steps inside one container.
- `alice/broken-build` — deliberately fails at step 3 of 4 so the failure
  UI is visible alongside the greens. Final status: failed, exit 7.

Plus the existing seed (`npm run seed:demo`) which creates `bakery`,
`notes`, `about` (the explainer site, published *through* the bridge),
`built-site` (the original workflow demo), `hello`, `lifecycle`.

---

## How to run it

```bash
docker compose up -d           # CSS on :3011
npm install
npm run dev                    # bridge on :3010
npm run seed:demo              # alice/{bakery, notes, about, built-site, hello, lifecycle}
npm run seed:workflows         # alice/{marked-blog, tailwind-site, broken-build}
npm run import:repo            # mind/compass (org example)
open http://localhost:3010
```

Everything is local, single-tenant, dev-mode. The CSS container persists
under `.css-data/`; the bridge's SQLite + bare repos under
`.registry-data/` and `.git-data/`.

---

## The architecture in one diagram

```
   ┌──────────────┐                                ┌──────────────────┐
   │  git client  │                                │   Solid Pod      │
   └──────┬───────┘                                │   (CSS at :3011) │
          │                                        │  alice/          │
          │ Git Smart HTTP                         │   ├── /profile/  │
          │ (clone / fetch / push)                 │   ├── /codespaces│
          ▼                                        │   │   /{repo}/   │
   ┌─────────────────────────────────────┐         │   │   index.ttl  │
   │  Mind Codespaces bridge (Next.js)   │         │   │ (Turtle meta)│
   │  http://localhost:3010              │         │   └── /public/   │
   │                                     │         │       /sites/    │
   │  Git Smart HTTP route               │  spawn  │         {repo}/  │
   │  → git http-backend (CGI) ──────────┼────────▶│         index.html
   │                                     │         │         …        │
   │  Workflow runner                    │         │                  │
   │  → docker run --rm node:22-alpine   │         └────────▲─────────┘
   │  → fallback: sh -c                  │                  │
   │                                     │  authenticated   │
   │  Pages publisher                    │  PUT (delegated  │
   │  → checkout → walk → PUT → prune ───┼──or seeded OIDC)─┘
   │                                     │
   │  Registry (SQLite)                  │
   │  repos · pages · tokens ·           │
   │  identities · identity_storage ·    │
   │  workflow_runs                      │
   │                                     │
   │  Dashboard + identity UI            │
   └─────────────────────────────────────┘
```

Three durable principles:

1. **Keep Git as Git.** The bridge never reimplements Git on top of pods.
   Bare repos live on disk where Git's own consistency rules (packfiles,
   refs, locks, gc) work normally. The pod holds the *output* of a build,
   not the build's git data.
2. **The bridge is replaceable.** Anyone could run another bridge against
   the same pod. The bare repo is throwaway — a single `git push` from any
   client recreates it.
3. **The pod is authoritative.** Identity (WebID), repository metadata
   (Turtle), and published artifacts all live on the pod. If the bridge
   goes away, the URLs survive.

---

## What was learned

A handful of things from the build worth carrying forward:

### Technical findings

- **WebVM is the wrong shape for a server-side runner.** CheerpX (the
  engine WebVM rides on) is proprietary and browser-only. WASM more
  broadly still can't credibly replace Docker for full Node build chains
  in 2026 — Wasmer Edge.js is the only candidate that even tries, and
  it's pre-1.0 with unproven native-deps support (`sharp`, `esbuild`,
  `swc`). Conclusion: **per-build Docker remains the boring-correct
  answer for arbitrary `npm` workflows**. See `WORKFLOWS-PLAN.md` for
  the full sweep.
- **Streaming `git http-backend` through Next.js Route Handlers works
  first try** once you get the spawn type signature right. The trick
  was `env: NodeJS.ProcessEnv = {...process.env, ...}` so the spawn
  overload resolves to `ChildProcessWithoutNullStreams`. Don't set
  `stdio: ["pipe","pipe","pipe"]` explicitly — it broke the type
  inference.
- **Public-read ACL has to be re-asserted on every publish** rather than
  set once at pod-setup time. If anything (admin tool, another bridge,
  the user) narrows the ACL between publishes, the next publish corrects
  course.
- **Tailwind v4's preflight strips list-style and font-weight**. Both have
  to be restored explicitly in custom CSS for `.markdown-body` to render
  README ordered/unordered lists.
- **Turbopack's CSS hot-reload caches stale bundles**. `rm -rf .next` is
  the only reliable way to pick up CSS changes during dev. Documented in
  `AGENTS.md` after losing 15 minutes to it.
- **YAML plain-scalar colons are a footgun.** The `broken-build` demo's
  workflow line `sh -c 'echo expected: 42; ...'` parsed as a mapping
  until we wrapped the whole scalar in double quotes. Now documented in
  the demo's README so the gotcha is visible.
- **The publisher's prune-on-republish had three bugs in a row.** Turtle
  parsing with `[^;.]+?` broke on dots inside filenames; CSS returns
  relative URIs (not absolute); the prune walk needed proper container
  recursion. Rewriting the parser as an imperative scanner that walks
  `<URI>` tokens between `ldp:contains` and `;`/`.` made it bulletproof.
  **This is the most fragile module in the codebase** and the strongest
  candidate for the first test suite if you write one.

### Design decisions

- **Single-tenant prototype, single-tenant threat model.** No sandbox at
  the workflow runner's step 1 was a deliberate choice — the operator
  pushes their own repos. Step 2a (Docker auto-detect) added "the build
  can't trash the host filesystem"; step 2b (network isolation, secret
  injection, mirror) is what multi-tenant hosting would need but
  doesn't exist yet.
- **Editorial UI, not SaaS UI.** Serif display headings, monospace
  eyebrows, restrained palette. Survived three iteration rounds without
  having to redesign — the visual language is the right one for a
  dashboard that sells a thesis.
- **Two-column repo detail (main + sidebar)** turned out to be the
  highest-impact UI change of the whole prototype. The page is a
  dashboard, not an editorial article, and pretending it was a
  single-column read was costing scannability.

---

## Would it be a good Mind product?

The honest answer: **a strong wedge, not a standalone product**.

### Where it's compelling

- **It proves the Mind thesis end-to-end.** "Your pod is your platform"
  goes from slide to working software. Push → build → publish → URL on
  your pod, with the bridge replaceable. That's a real demonstration of
  user-owned infrastructure.
- **It's a great teaching artifact.** The agentic-coding-course framing
  (small, focused milestones, working end-to-end after each) was the
  right shape and worked well in practice. The prototype's source is
  readable, the architectural separations are clean, and the seed scripts
  let a course participant get to a working live URL in five minutes.
- **It opens a category.** If "developer tooling on a Solid pod" is
  viable for static publishing, it's plausibly viable for collaborative
  docs, design files, project management — adjacent products that share
  the same identity + storage layer.
- **The workflow runner is non-trivial.** A working CI in a few hundred
  lines with real Docker isolation, real auto-detect/fallback, real
  per-step semantics, and an honest sandbox-vs-network trade-off. That's
  legitimately useful as a building block beyond this prototype.

### Where it's thin

- **The audience intersection is tiny right now.** Solid users ∩ people
  who want self-hosted Git ∩ people who don't want GitHub. Each set is
  small; the intersection is much smaller.
- **Solid hasn't crossed a tipping point.** Depending on a thin ecosystem
  for the storage substrate is real risk. If Solid adoption stays flat,
  this product's market stays flat.
- **The non-Solid competition is far ahead.** Cloudflare Pages, Vercel,
  Netlify, Fleek, even Skiff dominate the "free static hosting + git
  push" space with better UX, edge networks, and integrated team
  features. The pod-ownership story is ideological — most static-site
  publishers don't actively suffer from not having it.
- **No collaboration story.** Pull requests, issues, code review,
  notifications — that's ~80% of why people use GitHub instead of just
  a private remote. Without those, this is "self-hosted git remote
  with a publish step," which is a much smaller pitch.
- **Two-sided operational cost.** Someone runs the bridge AND someone
  hosts the pod. The pod-hosting market is nascent. A serious product
  would probably need to be both bridge and pod host, which is a much
  bigger engineering scope.
- **Self-sovereignty's safety net is weak in practice.** "If the bridge
  is hostile, point another bridge at your pod" works *technically* but
  only matters if your audience has bookmarked your pod URL. Most
  hostility scenarios (account suspension, takedown) are at the pod-host
  layer, not the bridge layer.

### What it would take to ship as a product

In rough order of cost:

1. **Workflow secrets** (~1–2h, the one obvious next step).
2. **A test suite seeded around the publisher's prune logic** (~2h).
3. **Multi-tenant containerization** — step 2b: per-build network
   isolation, package mirror, secret injection, per-repo image
   selection. Real engineering work, not a weekend.
4. **A collaboration surface** — at minimum, a "fork by re-pointing"
   flow and a way to comment on a repo without needing PRs.
5. **Hosted pod offering** or a tight partnership with a pod host. The
   "BYO pod" model only works for a small expert audience.
6. **A reason for non-ideologues to use it** — speed, price, integration
   with other Mind products, a feature competitors can't match.

That's a 6–12 month roadmap to a sellable product, mostly in items 3, 4,
and 5.

### Verdict

The prototype's highest-value uses are:

1. **As a building block in the larger Mind ecosystem story.** Paired with
   `mind-market-v0` and any future pod-native products, it makes "your pod
   is your platform" a *category* not a slogan.
2. **As an educational asset for the agentic-coding course.** Small,
   end-to-end, exercises every layer (Git, HTTP, Solid OIDC, Docker,
   SQLite, React, Tailwind), iterative milestone structure was perfect
   for AI-pair development.
3. **As a proof that the Solid stack can host real developer tooling**,
   which is a non-obvious result worth knowing even if this specific
   product never ships.

It is probably **not** a standalone product. If forced to choose: invest
the next quarter in items 1 and 2 (course + ecosystem narrative), not in
items 3–6 (the productization work).

---

## Status

**Done.** Every committed and stretch milestone shipped, plus a meaningful
amount beyond the PRD (dark mode, code browser, README rendering, the
`mind` org, the Docker runner, three workflow demos, three rounds of UX
polish). The remaining items in `WORKFLOWS-PLAN.md` (step 2b, step 3
server WASM, step 4 browser WASM preview) are explicitly future work, not
omissions from the prototype scope.

The code is type-clean (`tsc --noEmit` exit 0), runs end-to-end on a fresh
checkout in about five minutes, and the three seeded demos let a new
visitor see the whole story without having to push anything themselves.

If this is the stopping point, the artifact stands on its own. If it
isn't, the three honest next steps are:

1. Workflow secrets (~1–2h, completes the runner story).
2. A test suite seed (~2h, protects the publisher's prune logic).
3. Anything from the productization list above — but only if the
   product question has been answered "yes."
