# Changelog

What shipped in each iteration. Most-recent at the top.

## v0.5 — Cleanup pass

- Extracted `ensureContainer` + `setPublicReadAcl` into `src/lib/solid/containers.ts` (the two copies in `publisher.ts` and `repo-metadata.ts` were bit-for-bit identical).
- Updated README to document `/connect`, `/identities`, push tokens, and the full endpoint surface.
- Refreshed PRD: M8–M11 marked as shipped; "what gets unlocked" rewritten as a forward-looking list (no longer mentions things we already built).
- Fixed stale comment on the `push_tokens` migration ("placeholder, not used in MVP" → describes the actual behaviour).
- Added this changelog.

## v0.4 — Real Solid-OIDC delegation (M11)

- `/connect` page kicks off the full Inrupt SDK authorization-code flow against the pod's OIDC issuer. Dynamic client registration as **Mind Codespaces**; the user sees a real CSS consent screen.
- Tokens persisted to SQLite via a custom `IStorage` (`src/lib/registry/identities.ts`) backing the SDK's `Session` model. `identities` table maps `WebID → session_id`; `identity_storage` is the SDK's K/V.
- `/identities` page lists connected pods, supports disconnect (drops the mapping + KV rows).
- New `src/lib/solid/fetch-for-owner.ts` exposes `getOwnerFetch(webId)` returning `{ fetch, mode: 'delegated' | 'seeded' }` — publisher and metadata writer both went through it. Delegated wins when available; seeded credentials remain as fallback for unconnected WebIDs (keeps the existing demo working without forcing the OIDC flow).
- Dev log gained `[publisher] auth mode: delegated|seeded` to make the source of auth visible end-to-end.

## v0.3 — Stretch milestones (M8 + M9 + M10)

- **M8 — Pod-side repo metadata:** `solidgit:Repository` Turtle written to `{podRoot}/codespaces/{name}/index.ttl` on POST /repos, PATCH /repos/.../, and PUT /pages. Best-effort; pod failures log but don't break the API call. New `src/lib/vocab.ts` namespace module.
- **M9 — Push tokens:** `scp_…` plaintext tokens, `sha256` at rest. CRUD under `/api/repos/{o}/{r}/tokens`. Git Smart HTTP gate: always required for `git-receive-pack`; required for `git-upload-pack` when `visibility=private`. 401 with `WWW-Authenticate: Basic realm="owner/repo"`. Username is ignored — any holder of a valid token wins.
- **M10 — Dashboard + seed-demo:** `/repos` list + `/repos/{o}/{r}` detail page (clone URL, owner WebID, pod root + metadata Turtle link, Pages config, token manager). `scripts/seed-demo.ts` (idempotent) creates `alice/bakery` (multi-page bakery site) and `alice/notes` (notebook), mints a token per repo, force-pushes, waits for publish.

## v0.2 — Rename: "Solid Pages" → "Mind Pages" (the feature)

- The publishing feature (the GitHub-Pages parallel inside the prototype) is now **Mind Pages**. The prototype itself remains **Mind Codespaces**. The PRD title is "Mind Codespaces — Solid Git Bridge + Mind Pages MVP PRD".
- Distinction: **Mind Codespaces** = product / prototype; **Mind Pages** = the artifact you `git push` into your pod.

## v0.1 — MVP (M0–M7)

- **M0 — PRD authored.** Vision, architecture diagram, milestones, scope (in/out).
- **M1 — Scaffolding.** Next.js 16 + TypeScript + Tailwind on :3010, `/api/health`.
- **M2 — Single CSS Docker instance.** CommunitySolidServer v7 on :3011 with seeded `alice` user.
- **M3 — Repo registry.** SQLite with `repos`, `pages_configs`, `push_tokens`. CRUD under `/api/repos`. Strict name validation, path-traversal-proof.
- **M4 — Bare git repo creation.** `git init --bare` under `.git-data/repos/{owner}/{name}.git/`. Path resolution boundary check. Rollback registry row on git failure.
- **M5 — Git Smart HTTP delegation.** `/api/git/{o}/{r}/[...path]` spawns `git http-backend` as CGI; streams stdin in, parses CGI headers out, streams response. `git clone` and `git push` work.
- **M6 — Post-receive event.** Hook installed at repo-creation time `curl`s `/api/git/internal/post-receive` (loopback). Handler logs `repo.updated`, schedules publish if the ref matches.
- **M7 — Pages publisher.** Checkout source branch to temp dir → walk source path (skip `.git`/`.env`/`node_modules`) → PUT each file to the configured Solid container with the right MIME type. Sets `/public/` ACL to public-read idempotently. End-to-end: `git push` → site live at a pod URL.

## Operational notes

- The post-receive hook bakes the bridge's callback URL at install time (read from `BRIDGE_PUBLIC_URL` or the default `http://127.0.0.1:3010`). Changing the bridge URL means rerunning `createBareRepo` to regenerate the hook, or `sed`-ing the existing `hooks/post-receive` files.
- The OIDC dynamic client registration is stored inside the pod's OIDC issuer state (CSS keeps it under `.account/`). If you `rm -rf .css-data`, you need to re-authorize via `/connect`. Existing identities in the bridge's SQLite become stale.
- Both prototypes (`mind-market-v0`, `mind-codespaces-v0`) currently share the same `:3011` port for their CSS instances. Run one at a time.
