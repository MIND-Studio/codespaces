# Mind Packages — registry design plan

Status: **shipped + UI + live-verified (v0.7–v0.8.1)** · Sibling of [`WORKFLOWS-PLAN.md`](./WORKFLOWS-PLAN.md) and the Mind Pages feature.

> **Live verification (v0.8.1).** All three formats were exercised end-to-end
> against the local CSS, with bytes confirmed in the pod CAS: generic file
> (curl), npm (`npm publish` → `npm install` → `require()`), and OCI (the full
> Distribution v2 wire sequence **and** a real `crane push`/`pull`/`export`
> round-trip over plain HTTP). A dashboard **Packages** tab/page now lists
> published artifacts (`/repos/{o}/{r}/packages`). One bug found and fixed: the
> `GET /v2/` version ping was 308-redirected by Next's trailing-slash handling
> (`skipTrailingSlashRedirect: true` in `next.config.ts`). Plain-HTTP `docker`
> on Docker Desktop needs `insecure-registries` or a `crane --insecure` client —
> see the README caveat. Decision record: [`adr/0001-mind-packages-in-the-bridge.md`](./adr/0001-mind-packages-in-the-bridge.md).

> **Implementation note.** All three formats shipped, built directly in the
> bridge as designed. One refinement vs. the sketch below: the registry is
> **repo-scoped**, not bare-owner-scoped — packages hang off an existing repo so
> they reuse its identity (`ownerWebId`/`ownerPodRoot`), `visibility`, and **push
> tokens** (no new token table). npm scope = owner, registry base =
> `/api/packages/npm/{owner}/{repo}/`; OCI image name = `{owner}/{repo}[/{image}]`
> at the top-level `/v2/` mount. Code: `src/lib/packages/` +
> `src/app/api/packages/npm/…` + `src/app/api/repos/{o}/{r}/{files,packages}/…` +
> `src/app/v2/…`, migration `015_packages.sql`. The content-addressed
> `PodContentStore` is shared by all three formats.
>
> **OCI v0 limitations** (documented, not bugs): blob uploads accumulate in
> memory (capped by `MAX_PACKAGE_BLOB_BYTES`) — large layers need the streaming
> follow-up; auth is HTTP-Basic (push token as password via `docker login`) —
> the bearer/JWT token-endpoint flow is the v1; manifest blobs referenced across
> repos dedup within one owner's pod CAS but cross-mount (`?mount=`) is not
> implemented (clients fall back to normal upload).

The bridge already does Pages (static sites → pod), Actions (`.mind/workflow.yml`), and
Agents (issue-driven coder). This adds the fourth surface: **Mind Packages** — a
package/artifact registry for **npm packages, Docker/OCI images, and generic files/zips**,
where the artifact bytes live in the owner's Solid Pod, mirroring how Pages publishes.

The thesis is unchanged: **the bridge is protocol glue; the bytes live in the pod.** A
registry is "Mind Pages for non-HTML artifacts."

---

## TL;DR

- **Build the protocol front-ends directly in the Next.js bridge. Do not adopt or fork an
  existing registry product.** The wire protocols we need are small, and a forge (Gitea/Forgejo)
  or a Go registry (distribution/zot) would duplicate our git host, auth, DB, and UI while
  *still* requiring us to write the pod storage backend ourselves.
- **Borrow Gitea/Forgejo's *architecture*, not its code** (it's MIT — read it freely): three
  layers — per-format metadata extractor + per-format native protocol router + **one
  content-addressed (sha256) blob store** with reference counting + GC. We already implement
  this exact split (publisher → pod for bytes, SQLite for metadata).
- **Keep Verdaccio doing only what it does today** — upstream npm proxy/cache for workflow
  sandboxes. It is *not* the publish target for pod-hosted packages.
- **Phasing by ascending effort / descending immediacy:** generic files (S) → npm (S–M) → OCI (M).

---

## Open-source landscape (what we researched)

### npm registries

| Project | Lang | License | Storage pluggable? | Maintained | Fit for "bytes in pod" |
|---|---|---|---|---|---|
| **Verdaccio** | Node/TS | MIT | Yes (`IPluginStorage`/`IPackageStorage`) | Active (v6/v7) | Awkward — plugin API changed v5→v6, canonical FS plugin repo archived, stream/callback contract fights a latency + ACL-gated remote store. **Keep as uplink proxy, not pod backend.** |
| **cnpmcore** | TS | MIT | Yes (storage adapters) | Very active | Heavy — needs MySQL + Redis + task queue. Overkill for "thin glue." |
| **Sinopia** | Node | MIT | plugin-ish | **Dead** (recommends Verdaccio) | N/A |
| **Gitea/Forgejo npm** | Go | MIT | internal (local/minio/S3) | Active | Not adoptable as a lib, but the **best minimal-endpoint reference**. |

**Decisive facts.** The npm publish/install wire protocol is ~6 route shapes (publish is a
single `PUT /:pkg` with the tarball base64-inlined in `_attachments`). Gitea, Forgejo, and
GitLab all implement this thin facade themselves rather than embedding Verdaccio. Verdaccio's
storage-plugin path means coupling to an unstable, sparsely documented callback/stream
interface to get *less* control than writing the handful of routes ourselves.

### OCI / Docker registries

| Project | Lang | License | Storage pluggable? | Remote-store feasible? | Fit |
|---|---|---|---|---|---|
| **distribution/distribution** (reference) | Go | Apache-2.0 | Compile-time only (`init`-registered factory; no Go plugins; upstream not accepting new drivers) | Only via a maintained Go fork | Medium — Go fork + reimplement pod I/O + ACL outside our TS stack |
| **zot** | Go | Apache-2.0 | No third-party SPI (FS + AWS S3 only) | No | Poor |
| **Direct OCI subset in Node** | TS (ours) | ours | We own it | Native | **Best** — pod *is* the backend |
| **S3-gateway-over-pod hack** | mixed | — | — | Effectively no | **Avoid** |

**Decisive facts.** The OCI Distribution Spec subset for `docker push`/`docker pull` is ~8
stable, conformance-tested endpoints, and OCI is **natively content-addressed by sha256** —
which is exactly how a pod content store wants to be keyed. The S3-gateway route is dead:
MinIO gateway mode was removed in 2022, no S3-over-arbitrary-HTTP shim exists, and the S3 ACL
model cannot express Solid WAC/ACP anyway. distribution-with-a-custom-Go-driver is the only
viable "reuse" path and it splits our Solid logic across two languages for little gain.

### Unified / universal registries

| Project | Formats | License | Multi-format in FOSS edition? | Storage pluggable? |
|---|---|---|---|---|
| **Gitea / Forgejo Packages** | ~22 (npm, OCI, generic, Maven, PyPI, Cargo…) | **MIT / FOSS** | **Yes, all free** | Yes (`storage.ObjectStorage`: local/minio/azureblob) |
| **Nexus Repository CE** | 40+ | EPL source + EULA binary, **usage caps** | Mostly, but capped | Yes (blob stores) |
| **Artifactory OSS** | Maven/Gradle/Ivy only | Apache-2.0 | **No** (multi-format paywalled) | FS; S3 commercial |
| **Harbor** | OCI only | Apache-2.0 | n/a (single protocol) | Pluggable (distribution drivers) |
| **Cloudsmith / packagecloud** | 30+ | Proprietary SaaS | n/a | n/a |

**Only Gitea/Forgejo** are FOSS + cover all three target formats + have a swappable storage
interface. But adopting the whole forge duplicates everything we already own. The value is the
**design**, described next.

---

## The architecture we're borrowing (Gitea/Forgejo's three-layer split)

1. **Per-format metadata extractor** — `modules/packages/<format>/` in Gitea. Its only job:
   parse the uploaded bytes and extract metadata (read `package.json` from a tarball, parse an
   OCI manifest). Adding a format = adding one isolated module; nothing else changes.
2. **Per-format native protocol router** — `routers/api/packages/<format>/`. Each format speaks
   the wire protocol its native client expects (npm's `PUT /:pkg`, OCI's `/v2/...`). **There is
   no unified upload API at the protocol edge** — the unification is internal.
3. **One shared content-addressed blob store** — `modules/packages/content_store.go` behind a
   ~4-method `ObjectStorage` interface (`Save`/`OpenBlob`/`Has`/`Delete`). Blobs keyed by
   sha256 → automatic cross-format dedup; metadata (package/version → blob graph) lives in the
   relational DB; a GC job sweeps unreferenced blobs.

We already have layer 3 in spirit (`publishDirectory()` → pod, SQLite registry). We extend it
into a proper content-addressed `PodContentStore` and add layers 1 and 2 per format.

---

## Validation against the bridge's architecture

Reusable primitives that already exist (verified, with file paths):

| Need | Existing primitive | Location |
|---|---|---|
| Write bytes to a pod path | `publishDirectory()`, `walk()` (generic "walk + PUT + prune", not git-coupled) | `src/lib/pages/publisher.ts:137,395` |
| Create pod containers + public ACL | `ensureContainer()`, `setPublicReadAcl()` (owner RWC + `foaf:Agent` Read) | `src/lib/solid/containers.ts` |
| MIME mapping | `mimeForPath()` (fallback `application/octet-stream`) | `src/lib/pages/mime.ts:29` |
| Delegated vs seeded pod fetch | `getOwnerFetch(webId)` | `src/lib/solid/fetch-for-owner.ts` |
| Token mint/verify (sha256, `scp_` prefix, constant-time) | `createPushToken()` / `verifyPushToken()` | `src/lib/registry/tokens.ts` |
| Quotas | `assertCanCreateRepo`, disk-byte check, `QUOTAS` config | `src/lib/registry/quotas.ts` |
| Per-repo serialization | publish-lock | `src/lib/pages/publish-lock.ts` |
| Workflow `publish:` hand-off | runner calls `publishDirectory()` on success | `src/lib/workflows/runner.ts` |
| Numbered SQL migrations | next is `015_*.sql` | `src/lib/registry/migrations/` (last is `014_pr_previews.sql`) |

### Constraints / gotchas this design must handle

1. **50 MB per-file cap will block Docker layers.** `MAX_PUBLISH_FILE_SIZE` defaults to
   `50 * 1024 * 1024` (`publisher.ts:69`) and the walker *skips* larger files. The registry
   path needs its own ceiling (separate env, e.g. `MAX_ARTIFACT_BLOB_BYTES`) and ideally
   streaming.
2. **No streaming PUT today.** The publisher reads each file fully into memory before `PUT`.
   Fine for npm tarballs and most generic files; **not** fine for large OCI layers. OCI blob
   upload should stream request → pod (`fetch` body as a stream / chunked `PATCH` accumulation).
3. **Pod ACLs gate *access*, not *protocol*.** npm and docker clients don't speak Solid auth,
   so **private-package access control is enforced at the registry API layer** (token check on
   every request), with the pod ACL as a defense-in-depth second layer. Public packages can set
   `setPublicReadAcl()` and even 307-redirect blob GETs straight to the pod URL.
4. **Auth scheme differs from Git Smart HTTP.** Git push uses HTTP-Basic; npm uses
   `Authorization: Bearer <_authToken>`; OCI uses a bearer + `WWW-Authenticate` scope challenge.
   The **token store is reusable** (extend `push_tokens` with a `token_type`, or add an
   `artifact_tokens` table) but each protocol needs its own auth handler.
5. **Verdaccio stays the npm *uplink***. Workflow containers proxy npmjs through it on the
   isolated `mind-workflows` network. Our registry serves private + pod-hosted packages and is
   not Verdaccio-backed. (No equivalent Docker pull-through cache exists yet — out of scope.)
6. **Solid has no storage quota.** We enforce ours: add `MAX_ARTIFACT_BYTES_PER_REPO` (Docker
   layers are large) and `MAX_ARTIFACTS_PER_REPO`, alongside the existing per-repo disk check.

---

## Proposed shape

### Storage: `PodContentStore` (content-addressed)

A small module — `src/lib/packages/content-store.ts` — exposing `Save(reader|bytes) → digest`,
`OpenBlob(digest)`, `Has(digest)`, `Delete(digest)`, built on `getOwnerFetch` +
`ensureContainer`. Blobs land at a content-addressed path in the pod:

```
/codespaces/{owner}/packages/_blobs/sha256/<aa>/<aabbcc…>     # immutable, dedup'd, refcounted
/codespaces/{owner}/packages/npm/<pkg>/<version>/…            # metadata pointers
/codespaces/{owner}/packages/oci/<name>/manifests|tags/…      # manifest + tag → digest
```

`HEAD`-before-`PUT` makes uploads idempotent (content-addressed → re-push is a no-op). Public
containers get `setPublicReadAcl()`; private containers get an owner-only ACL.

### Index: SQLite (migrations `015`/`016`)

```sql
-- 015_packages.sql
CREATE TABLE packages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner         TEXT NOT NULL,
  type          TEXT NOT NULL,           -- 'npm' | 'oci' | 'file'
  name          TEXT NOT NULL,
  version       TEXT NOT NULL,           -- semver / tag / release name
  visibility    TEXT NOT NULL DEFAULT 'public',
  size_bytes    INTEGER,
  created_at    INTEGER NOT NULL,
  UNIQUE (owner, type, name, version)
);
CREATE TABLE package_blobs (             -- the version → blob refcount graph (for GC)
  package_id    INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  digest        TEXT NOT NULL,           -- sha256:…
  PRIMARY KEY (package_id, digest)
);

-- 016_artifact_tokens.sql  (or add token_type to push_tokens)
CREATE TABLE artifact_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_type TEXT NOT NULL,              -- 'npm' | 'oci' | 'generic'
  label TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
```

Reference counting in `package_blobs` lets deletes drop references and a GC sweep remove
unreferenced pod blobs — copied straight from Gitea's model so pod storage stays clean.

### Protocol routers (Next.js App Router)

```
src/app/api/packages/npm/[...path]/route.ts     # GET packument, GET tarball, PUT publish, dist-tags
src/app/api/packages/oci/v2/[...path]/route.ts   # /v2/ check, blob upload POST/PATCH/PUT, blob GET/HEAD, manifest PUT/GET, tags/list
src/app/api/packages/files/[owner]/[name]/...    # generic: PUT upload, GET download, list
```

> Note: the OCI client requires the literal `/v2/` prefix. Either mount at `/v2/...` at the app
> edge or have the bridge advertise the realm so `docker login`/`docker pull` resolve. Decide
> during the OCI phase (Caddy rewrite vs a top-level `/v2` route group).

### Auth mapping

- **npm** — `Authorization: Bearer <token>`; user pastes the token into `~/.npmrc`
  (`//host/api/packages/npm/:_authToken=…`). Validate against the token store, scoped per owner.
- **OCI** — start with **Basic auth** (push-token as password) against `/v2/`, which Docker
  accepts when no bearer realm is advertised → lets v0 skip the token server. Add the proper
  `WWW-Authenticate: Bearer realm=…,scope="repository:<o>/<n>:pull,push"` + short-lived JWT
  endpoint in v1.
- **generic** — same token store; Basic or Bearer.

### Workflow integration (closing the loop)

Extend `.mind/workflow.yml` so an Action can publish to the registry, mirroring how `publish:`
hands a build dir to the Pages publisher:

```yaml
run:
  - npm ci && npm run build
publish:
  npm: .            # npm publish the built package
  # oci: Dockerfile # build + push an image
  # files: dist/    # upload generic artifacts
```

The runner dispatches to the matching package publisher instead of (or alongside)
`publishDirectory()`.

---

## Phasing

| Phase | Scope | Effort | Status |
|---|---|---|---|
| **0 — generic files** | `PodContentStore` + `packages` table + `PUT`/`GET`/list routes + token auth | **S** | ✅ **shipped (v0.7)** |
| **1 — npm** | packument GET, tarball GET, `PUT` publish (decode `_attachments`); Bearer auth via token store | **S–M** | ✅ **shipped (v0.7)** — dist-tags resolved as latest=newest; explicit dist-tag CRUD endpoints still TODO |
| **2 — OCI** | `/v2/`, blob upload `POST/PATCH/PUT` (monolithic + chunked), blob `GET/HEAD`, manifest `PUT/GET/HEAD`, `tags/list`; HTTP-Basic auth | **M** | ✅ **shipped (v0.8)** — content-addressed blobs map 1:1 to the pod CAS. Follow-ups: streaming for large layers, bearer/JWT token endpoint, `?mount=` cross-repo dedup, OCI conformance suite run. |

Each phase ships independently and reuses the prior phase's `PodContentStore` + index + quotas.

---

## Decisions deferred

- **Pod container namespace** — `/codespaces/{owner}/packages/…` vs a top-level `/packages/…`
  in the pod. (Leaning toward under `/codespaces/` to match repo metadata.)
- **`/v2/` mounting** — Caddy rewrite vs a top-level Next.js route group.
- **Token model** — extend `push_tokens` with `token_type` vs a separate `artifact_tokens`
  table. (Leaning separate table — different scopes, different auth schemes.)
- **OCI streaming** — chunked `PATCH` accumulation in the bridge vs streaming the final `PUT`
  body straight to the pod.

## Key references

- npm registry protocol: <https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md> ·
  minimal real impl (route list): <https://github.com/go-gitea/gitea/blob/main/routers/api/packages/api.go>
- OCI Distribution Spec: <https://github.com/opencontainers/distribution-spec/blob/main/spec.md> ·
  conformance: <https://github.com/opencontainers/distribution-spec/blob/main/conformance/README.md>
- OCI/Docker token auth: <https://distribution.github.io/distribution/spec/auth/token/>
- Gitea content store (`ObjectStorage` interface, the design we borrow):
  <https://github.com/go-gitea/gitea/blob/main/modules/packages/content_store.go>
- Verdaccio storage plugin API (why we *don't* use it as backend):
  <https://www.verdaccio.org/docs/plugin-storage/>
