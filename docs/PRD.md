# Mind Codespaces — Solid Git Bridge + Mind Pages MVP PRD

_(Developers `git push` to a thin bridge. The bridge keeps the bare repository on disk and publishes the configured branch into the developer's own Solid Pod as a plain static website. Identity, ownership, and the published artifact all live in the user's pod. The "platform" shrinks to a protocol translator and a directory.)_

## What this MVP proves

Three claims, all testable end-to-end:

1. **A pod can be your developer surface.** The same Solid Pod that holds a person's marketplace listings (see `mind-market-v0`) can also hold their published website — the *artifact* of `git push` is something the user owns, served from a URL under their pod.
2. **Git stays Git.** We don't reinvent the Git object model on top of Solid. Bare repositories remain bare repositories on disk; the bridge speaks Git Smart HTTP. Solid handles identity, metadata, and publishing — the things the user actually owns.
3. **A bridge is enough.** A small TypeScript service can sit between a Git client and a Solid Pod and produce a working "GitHub Pages" equivalent where the page lives at a Pod URL controlled by the user.

This is the smallest thing that's a *real* GitHub-Pages-style workflow — backed by user-owned data — not a demo.

## The model in one sentence

A developer creates a repo on the bridge, `git push`es their site to a configured branch, and a static copy appears at a Solid container they own; `git clone` and `git fetch` work normally over HTTP because the bridge delegates to the system `git http-backend`.

## The asymmetry between the bridge and the pod (important design choice)

- **The bridge** holds bare Git repositories on disk and translates protocols. It is *not* the source of truth for the published site, nor for the user's identity. If the bridge is replaced, the user's pod and its published site survive.
- **The pod** holds the user's WebID (identity), the published artifact (the site), and — in later milestones — the repository's public metadata as Linked Data (`solidgit:Repository`). The pod is what the user owns; everything else can be reconstructed.

Compare GitHub Pages, where both the repository *and* the published site live on platform-owned infrastructure under a platform-owned domain. Here, the artifact's canonical home is the pod.

## Scope: what's in

### Developer side

- A pod (provisioned on the local CommunitySolidServer instance for the prototype; any Solid pod the user already has, in principle)
- Create a repository via the bridge's HTTP API: `POST /api/repos { owner, name, ownerWebId, ownerPodRoot, visibility }`
- A real bare Git repository created on disk under `.git-data/repos/{owner}/{name}.git/`
- `git clone http://localhost:3010/api/git/{owner}/{name}.git` — works
- `git push http://localhost:3010/api/git/{owner}/{name}.git main` — works
- Configure Mind Pages per repository: `PUT /api/repos/{owner}/{name}/pages { enabled, sourceBranch, sourcePath, targetContainer }`
- A push to the configured source branch triggers a publish: the bridge checks out that branch into a temp directory, walks the source path, and `PUT`s each file to the configured Solid container with the correct MIME type
- After a successful publish, the site is reachable at the configured Solid Pod URL, e.g. `http://localhost:3011/alice/public/sites/my-site/`
- A minimal web landing page on the bridge that explains what the prototype is

### Solid Pod side

- A single CommunitySolidServer instance with one demo user `alice`
- Three containers per user established by the bridge's pod-setup step:
  - `/public/sites/` — public-read, where Mind Pages publishes
  - `/codespaces/` — public-read, reserved for repo metadata (stretch — see milestones)
  - default ACL inheritance for everything else
- ACL configured so the demo user has Write/Control on `/public/sites/`, and anyone can Read

### Shared (the thin bridge)

- **Repo registry**: a tiny SQLite registry of known repositories. Holds the mapping `owner/name → disk path`, ownership info (WebID, pod root), default branch, visibility, and the Pages config. Does *not* hold the source of truth for the *site* — that's the pod.
- **Git Smart HTTP**: delegated to the system `git http-backend` CGI binary. The bridge spawns it as a child process and pipes stdin/stdout through Next.js Route Handler streams.
- **Pages Publisher**: a small piece of glue code that, on receipt of a `post-receive` hook callback, checks out the configured branch and uploads it to the configured Solid container using `@inrupt/solid-client-authn-node` for authentication.
- **Authentication for the publisher**: the prototype holds the seeded demo user's credentials in env vars and uses them to authenticate uploads. Real OIDC delegation is out of scope.

## Scope: deliberately out

- Pull requests, code review, issues, discussions. No collaboration surface beyond `git push`.
- CI/CD, build pipelines, custom build steps. The publisher uploads exactly what's in the source path; you build before you push.
- Git LFS, packfile optimization, gc tuning. The bridge is the system `git` binary, and we take its defaults.
- Branch protection rules, required reviewers, status checks.
- A real Solid-OIDC integration where the *user* authenticates and the *bridge* acts on their behalf via a delegated token. The MVP uses a seeded credential.
- Per-repo push tokens, HTTP Basic auth, fine-grained permissions. Stretch milestone, not MVP.
- Pod-side Linked Data metadata (`solidgit:Repository` Turtle on the pod). Stretch milestone.
- Custom domains for published sites — the site lives at the pod URL.
- A polished web dashboard. Stretch milestone; for MVP the API is the surface.
- Multi-user, multi-host federation. One CSS instance, one demo user.
- Cleanup of stale files on republish (a republish overwrites; files removed from the source path stay on the pod until manually deleted). Acceptable for prototype.

## Architecture

```
   Developer's machine                                  Solid Pod (CSS)
   ┌──────────────┐                                     ┌──────────────────┐
   │  git client  │                                     │  alice's pod     │
   └──────┬───────┘                                     │  http://:3011/   │
          │                                             │  alice/          │
          │ git clone / push                            │   ├── /profile/  │
          │ (HTTP Smart Protocol)                       │   ├── /codespaces│
          │                                             │   │     /…/      │
          ▼                                             │   │  (metadata,  │
   ┌─────────────────────────────────────────┐          │   │   stretch)   │
   │  mind-codespaces-v0 bridge (Next.js)    │          │   └── /public/   │
   │  http://localhost:3010                  │          │       /sites/    │
   │                                         │          │         {repo}/  │
   │  /api/git/{owner}/{repo}/...      ──────┼──spawn──▶│         index.html
   │    │                                    │  git     │         style.css│
   │    │   ┌─────────────────┐              │  http-   │         …        │
   │    └──▶│ git http-backend│              │  backend │                  │
   │        │   (CGI)         │              │          └──────────────────┘
   │        └────────┬────────┘              │                  ▲
   │                 ▼                       │                  │ PUT
   │     .git-data/repos/{owner}/{repo}.git/ │                  │ authenticated
   │     (bare repository)                   │                  │ as seeded user
   │       │                                 │                  │
   │       │ post-receive hook fires         │                  │
   │       ▼                                 │                  │
   │  /api/git/internal/post-receive  ──────────▶ PagesPublisher (server-side)
   │       │                                 │       │
   │  Registry (SQLite)                      │       └─ git checkout branch
   │   ┌────────────────────┐                │           to temp dir
   │   │ repos              │                │           walk files
   │   │ pages_configs      │                │           PUT each one
   │   │ push_tokens        │                │
   │   └────────────────────┘                │
   └─────────────────────────────────────────┘
```

**Key properties:**

- The **source of truth for the repository** is the bare Git repo on disk under `.git-data/`. The pod does not hold Git objects — that would fight the way Git uses pack files, locking, and gc.
- The **source of truth for the published site** is the pod container. The bridge's temp checkout is throwaway; the pod has the canonical, addressable copy.
- **There is no central message store, no buyer/seller distinction, no chat.** This prototype is about publishing.
- The bridge is the smallest possible central piece: a protocol translator and a directory. Its source code, registry schema, and disk layout are public.

## The full developer flow — annotated for ownership

1. **Get a pod.** For the prototype, the CSS instance has a demo user `alice` (`dev-only-do-not-use-in-prod`) provisioned by `seed.json`. In a real deployment, the user brings any Solid pod.
2. **Tell the bridge about a repo.** A `POST /api/repos` registers the repo, creates a bare repository on disk, and records ownership in the registry. *No data leaves the user's machine yet — this is just bookkeeping on a server they trust.*
3. **Configure Mind Pages.** A `PUT /api/repos/{owner}/{name}/pages` declares: when a push lands on `sourceBranch`, treat `sourcePath` as the site root, and `PUT` it to `targetContainer` (a URL under the user's pod). The target container is *the user's*, not the bridge's.
4. **Push.** `git push http://localhost:3010/api/git/alice/my-site.git main`. The bridge speaks Git Smart HTTP via `git http-backend`. The push lands in the bare repo on disk.
5. **The post-receive hook fires.** The hook installed at repo-creation time `curl`s `POST /api/git/internal/post-receive` (loopback-only) with the updated ref. The bridge logs `repo.updated` and, if the ref matches the Pages source branch, kicks off `PagesPublisher.publish(repoId)`.
6. **The publisher publishes.** It clones the bare repo (single-branch, shallow) into a temp directory, walks the configured source path, and for each file:
   - Resolves a target URL under the user's pod
   - Reads bytes from disk
   - Looks up the MIME type from the extension
   - `PUT`s the file to the pod using a `fetch` authenticated as the seeded demo user
   - Skips forbidden files (`/.git`, `.env`, `node_modules/`, dotfiles whitelist-by-default)
7. **The site is live.** The user's `index.html` is reachable at the pod URL configured in the Pages config. The bridge has nothing further to do until the next push.
8. **Iterate.** Edit, commit, push again. The publisher overwrites. (No prune in MVP — stale files stay until manually deleted.)

There is no payout, no DNS, no platform-owned domain. The published URL lives in the user's pod. If the user changes pod providers, they take the URL space with them — provided they bring the same `/public/sites/` container layout.

## Data model — every field justified

**Bridge registry (SQLite, the smallest possible bookkeeping):**

- `repos`: `id, owner, name, owner_webid, owner_pod_root, default_branch, visibility, created_at` — what we need to find a repo's bare path on disk and know whose pod to publish into.
- `pages_configs`: `repo_id, enabled, source_branch, source_path, target_container, last_published_at` — declarative description of "when X branch lands, copy Y subtree to Z pod container."
- `push_tokens` *(stretch / M9)*: `repo_id, token_hash, label, created_at` — placeholder schema for per-repo bearer tokens. Not used in MVP.

**Bridge disk:**

- `.git-data/repos/{owner}/{name}.git/` — a real bare Git repository created by `git init --bare`. Owned by the bridge process. Contains a `hooks/post-receive` that calls back into the bridge.

**User's pod (the source of truth for what the user publishes):**

- `/public/sites/{name}/` — the published static site. Public-read ACL. Owned by the user.
- `/codespaces/{name}/index.ttl` *(stretch / M8)* — `solidgit:Repository` Linked Data describing name, owner, default branch, visibility, remote URL. Lets other Solid-aware tools discover the repository through the pod.

Notice what isn't there: no central database of *file contents*, no central message store, no commit log copied into the pod. The site files in the pod are the publishable artifact; the bare repo on disk is the version-controlled artifact. Two stores, each fit for purpose.

## Privacy and ownership guarantees specific to the MVP

Promised in the README, enforced in code:

1. The bridge holds only the bookkeeping it needs: repository names, owner identifiers, Pages configuration. It does not hold buyer or chat data because there are no buyers or chats here.
2. The *published artifact* lives in the user's pod. Replacing the bridge does not destroy any published site.
3. There is no third-party SaaS in the data path. No analytics, no CDN, no GitHub API. The bridge runs on a single box; the pod runs on a single box.
4. The bridge does not run user-provided build commands. The publisher only copies bytes. (Build pipelines are explicitly out of scope.)
5. The publisher refuses to upload `/.git/`, `.env`, `node_modules/`, and a small forbidden list — to prevent accidentally publishing secrets or vendored dependencies. This is enforced before the first `PUT`, not as a server-side filter on the pod.
6. The bridge's registry schema and disk layout are public; the prototype is single-tenant, single-host, and easy to inspect.

## Build phases / milestones

This is **an agentic-course prototype**, intended to be built in small, agent-friendly steps. M0–M7 are the MVP target; M8–M11 were originally stretch goals and all shipped in subsequent iterations (see `docs/CHANGELOG.md`).

**M0 — PRD authored**
*(this document)*

**M1 — Scaffolding**
Next.js 16 + TypeScript + Tailwind project copied from `mind-market-v0`'s skeleton, retitled, listening on `:3010`. `/api/health` returns `{ok: true}`.

**M2 — Single CSS Docker instance**
One CommunitySolidServer on `:3011` with seeded user `alice`. `curl http://localhost:3011/alice/profile/card` returns a WebID profile.

**M3 — Repo registry**
SQLite registry with `repos`, `pages_configs`, `push_tokens` tables. CRUD endpoints under `/api/repos`. Strict name validation, path-traversal-proof.

**M4 — Bare Git repo creation**
`POST /api/repos` triggers `git init --bare` under `.git-data/repos/{owner}/{name}.git/`. Rollback the registry row if Git fails.

**M5 — Git Smart HTTP delegation**
`/api/git/{owner}/{repo}/[...path]` route spawns `git http-backend` as a CGI, streams the request body in, parses CGI-style headers out, streams the rest of stdout back. `git clone` and `git push` against the bridge succeed.

**M6 — Post-receive event**
A `post-receive` hook installed at repo-creation time `curl`s `POST /api/git/internal/post-receive` (loopback-only). Handler logs `repo.updated` and triggers `PagesPublisher.publish(repoId)` if the ref matches the Pages source branch.

**M7 — Pages publisher (MVP done)**
Checkout the source branch to a temp dir; walk source path; `PUT` files to the configured Solid container using a `fetch` authenticated as the seeded demo user. End-to-end: `git push` → site live at a pod URL.

**M8 — Repo metadata on the pod (shipped)**
Writes `solidgit:Repository` Turtle to `{podRoot}/codespaces/{name}/index.ttl` at repo creation, on PATCH, and on PUT /pages. Best-effort: pod-side failures log but don't fail the API call.

**M9 — Per-repo push tokens (shipped)**
HTTP Basic auth on `git-receive-pack` (always) and on `git-upload-pack` (when `visibility=private`), against `sha256`-hashed tokens in `push_tokens`. 401 + `WWW-Authenticate: Basic realm="owner/repo"`. Username is ignored — any holder of a valid token wins.

**M10 — Dashboard + seed-demo (shipped)**
`/repos` list page (server-rendered) + `/repos/{o}/{r}` detail page with read-only Pages config and a client-side token manager. `scripts/seed-demo.ts` creates `alice/bakery` and `alice/notes` end-to-end (token mint → push → wait for publish).

**M11 — Real Solid-OIDC delegation (shipped)**
`/connect` page kicks off a Solid-OIDC authorization-code flow against the pod's OIDC issuer (dynamic client registration as "Mind Codespaces"). Tokens persisted to SQLite via a custom `IStorage` backing the Inrupt Node SDK. The publisher prefers delegated tokens, falling back to seeded credentials only for WebIDs that haven't authorized yet. `/identities` lists connected pods and supports disconnect.

## Tech stack

- **Bridge runtime:** Node.js + TypeScript (strict). Next.js 16 App Router (same as `mind-market-v0`).
- **HTTP:** Next.js Route Handlers. Streaming via `ReadableStream` for Git Smart HTTP. If streaming Route Handlers don't behave under the chunked-encoding edge cases of `git push`, the contingency plan is a small dedicated `http`-module server proxied behind Next.js.
- **Git:** the system `git` binary. `child_process.spawn` for `git init --bare`, `git http-backend` (CGI), and `git clone` for the Pages checkout.
- **Pod server:** [CommunitySolidServer](https://github.com/CommunitySolidServer/CommunitySolidServer) v7 via Docker. One instance on `:3011` with a seeded `alice` user.
- **Solid client:** `@inrupt/solid-client-authn-node` for both the seeded-credential fallback and the M11 OIDC delegation (Session API + `getSessionFromStorage` + custom `IStorage`). Container/ACL setup is hand-rolled Turtle PUTs in `src/lib/solid/containers.ts` (we don't need the higher-level `@inrupt/solid-client` for that surface).
- **Registry:** `better-sqlite3`. Migration system ported from `mind-market-v0/src/lib/indexer/db.ts`.
- **Styling:** Tailwind CSS 4.
- **Scripts:** `tsx` for one-shot scripts. No separate test framework for the prototype (matches `mind-market-v0`'s approach).

Everything in this stack is FOSS and self-hostable. No third-party SaaS.

## Risks worth naming

- **Git Smart HTTP streaming.** The Smart HTTP protocol uses chunked-encoded request bodies, sensitive headers (`Content-Type: application/x-git-{upload,receive}-pack-request`), and demands the response is streamed back without buffering — `git push` will hang if the server collects the body and responds at the end. Mitigation: delegate everything to `git http-backend` and stream both directions. Contingency: a small dedicated `http`-module server proxied behind Next.js if Route Handlers misbehave.
- **Streaming Route Handlers under Next.js 16.** Next.js 16 App Router supports `ReadableStream` in responses and `Request#body` as a stream, but the prototype is on an unfamiliar Next.js version (see `AGENTS.md`). We'll verify with real `git clone` early; if it fails, we fall back to the dedicated-server contingency.
- **Path traversal.** The bridge takes `{owner}`, `{repo}` from the URL and uses them to construct disk paths. Mitigation: strict regex on names (`/^[a-z0-9][a-z0-9._-]*$/i`, length ≤ 64, no `..`, no leading/trailing dots) plus a `path.resolve` boundary check that asserts the resolved repo path starts with the data directory.
- **Publishing secrets.** A naïve walk of the working tree would happily `PUT` `.env`, `secrets.json`, `node_modules/`. Mitigation: hardcoded forbidden list applied during the walk, before any `PUT`.
- **Authenticating to the pod.** ~~Real Solid-OIDC requires a multi-step flow that's awkward in a prototype.~~ Resolved in M11: `/connect` runs the full Inrupt SDK authorization-code flow against the pod's issuer; refresh tokens persist to SQLite via a custom `IStorage`; `getOwnerFetch(webId)` prefers delegated tokens and falls back to the seeded credential only if no identity is stored. The fallback is convenient for the demo but should be removed for any non-local deployment.
- **Port collision with `mind-market-v0`.** Both prototypes use CSS on `:3011`. Mitigation: not a real risk for an agentic course (demo-once-at-a-time), but the README will document it. The bridge itself listens on `:3010` to leave `:3000` free for `mind-market-v0`.
- **No deletion on republish.** Files removed from the source between pushes will linger on the pod. Mitigation: accept for MVP; document. A prune step is M11+ work.
- **The Next.js used here is *not* the Next.js most agents know.** Per `mind-market-v0/AGENTS.md`, breaking changes vs. older Next.js docs are expected. Mitigation: read the in-tree `node_modules/next/dist/docs/` before assuming the older App Router API still applies.

## What's still open (post-shipped-stretch)

M0–M11 are done. The remaining ideas, in roughly increasing effort:

1. **Deletion-on-republish.** The current publisher overwrites but does not prune — files removed from the source between pushes linger on the pod. A diff step that lists existing files in the target container and DELETEs the ones no longer in the source would close this. Optional allow-list of paths to preserve (hand-edited additions).
2. **Drop the seeded-credential fallback.** Now that OIDC delegation works, the `POD_USER_PASSWORD` env var only matters until a user runs through `/connect`. Removing the fallback is mostly a config + docs change; the seed-demo script would gain a one-time OIDC step.
3. **Cross-prototype demo.** Share a single CSS instance between `mind-codespaces-v0` and `mind-market-v0` so alice's pod hosts both her marketplace listings AND her bakery site. Concretely: align ports/data dirs and document the combined story.
4. **Build pipelines.** Sandboxed builds for static-site generators (Vite, Astro, Hugo, …). The interesting design question is sandboxing: containers per build, no network egress except to the pod, time/memory limits.
5. **Multi-host federation.** A repo on one bridge can publish to a pod on another host; the publisher follows the user's WebID to discover the right storage. Mostly an extension of the OIDC flow to accept any issuer, not just the local CSS.
6. **Pull request equivalent.** Lightweight collaboration via pod-to-pod inboxes (the `mind-market-v0` inbox/request pattern, repurposed for code review).
7. **Production deploy story.** Dockerfile for the bridge, `docker-compose.prod.yml` with Caddy in front, secret-handling guidance — `mind-market-v0` has this shape, this prototype doesn't yet.
8. **Tests.** No automated test suite exists. End-to-end verification has been by `curl` + `git` + Playwright through the dashboard.

Each of these is additive, not a rewrite. The shipped surface is deliberately the floor.

## Demo scenario

`alice` is a baker who already runs a `mind-market-v0`-style marketplace listing for her bakery. She now wants a small website with her opening hours and the week's bread menu, hosted out of the same pod.

1. She points the bridge at her pod: `POST /api/repos { owner: "alice", name: "bakery-site", ownerWebId: "http://localhost:3011/alice/profile/card#me", ownerPodRoot: "http://localhost:3011/alice/", visibility: "public" }`.
2. She configures Mind Pages: `PUT /api/repos/alice/bakery-site/pages { enabled: true, sourceBranch: "main", sourcePath: "/", targetContainer: "http://localhost:3011/alice/public/sites/bakery-site/" }`.
3. From a local working directory, she pushes a hand-written `index.html`, `style.css`, and a banner image.
4. She opens `http://localhost:3011/alice/public/sites/bakery-site/index.html` and sees her site.

The pod that already holds her marketplace listings now also holds her website. *Same pod, more uses.*
