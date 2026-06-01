# 0001 — Mind Packages lives in the bridge, on a pod-backed CAS

Status: **Accepted** (2026-06-01, shipped v0.7–v0.8.1)

## Context

The bridge already does Pages (static sites → pod), Actions (`.mind/workflow.yml`),
and Agents (issue-driven coder). We wanted a fourth surface: a package/artifact
registry for **npm packages, Docker/OCI images, and generic files/zips**, keeping
the project thesis — *the bridge is protocol glue; the bytes live in the owner's
Solid Pod.*

Two structural questions had to be answered before writing code:

1. **Adopt/fork an existing registry, or build the protocol front-ends ourselves?**
   Candidates: Verdaccio (npm), `distribution`/`zot`/Gitea-packages (OCI),
   MinIO-gateway-over-pod (S3). See the landscape tables in
   [`../PACKAGES-PLAN.md`](../PACKAGES-PLAN.md).
2. **Build it *into* the bridge, or stand up a separate microservice** so the
   registry is independently reusable?

## Decision

**Build the protocol front-ends directly in the Next.js bridge, as a modular
monolith — not a microservice, not a forked product.**

- **No forked product.** Verdaccio's storage-plugin API is unstable and its
  stream/callback contract fights a latency- and ACL-gated remote store; the Go
  registries (`distribution`/`zot`) and forges (Gitea) would duplicate our git
  host, auth, DB, and UI *and* still require us to write the pod backend. MinIO's
  S3-gateway-over-arbitrary-store mode was removed and can't express Solid ACLs.
- **Borrow Gitea/Forgejo's *architecture*, not its code:** three layers — a
  per-format metadata extractor, a per-format native protocol router, and **one
  content-addressed (sha256) blob store**. We already run exactly this split for
  Pages (bytes → pod, metadata → SQLite).
- **In the bridge, not a microservice.** The reuse substrate is *the pod*, not a
  service: any Mind app can read `{podRoot}/public/packages/blobs/…` directly. A
  separate registry service would become the **first runtime dependency between
  the sibling prototypes**, violating their "independent siblings" design, and
  would still need its own copy of repo identity, visibility, and push-token
  auth. Keeping it in-process lets all of that be reused for free.
- **Repo-scoped, not bare-owner-scoped** (a refinement on the plan's sketch):
  packages hang off an existing repo, reusing its `ownerWebId`/`ownerPodRoot`,
  `visibility`, and **push tokens** (no new token table). npm registry base =
  `/api/packages/npm/{owner}/{repo}/`; OCI image name = `{owner}/{repo}[/{image}]`
  at the top-level `/v2/` mount; files at `/api/repos/{o}/{r}/files/{version}/{file}`.

## Consequences

- One shared `PodContentStore` (`src/lib/packages/content-store.ts`) carries npm
  tarballs, OCI layers/configs/manifests, and files — identical bytes dedup
  within an owner's pod (HEAD-before-PUT). Index in `015_packages.sql`.
- Auth is uniform: the same `scp_…` push token that authorizes `git push`
  authorizes publishing (npm `Bearer`/`_authToken`, Docker/files HTTP-Basic).
- The `/v2/` OCI mount required `skipTrailingSlashRedirect` (the version ping is
  `GET /v2/` with a trailing slash; a 308 redirect reads as "not a v2 registry").
- **Accepted v0 limitations** (tracked, not bugs): in-memory blob uploads capped
  by `MAX_PACKAGE_BLOB_BYTES` (no streaming → very large OCI layers unsupported);
  HTTP-Basic only (bearer/JWT token endpoint is v1); no `?mount=` cross-repo blob
  mount; no blob GC/refcount yet; private-package blobs are public-read in the
  pod CAS — privacy is enforced at the API/index layer, not by the bytes' ACL.
- Plain-HTTP `docker push` against Docker Desktop needs `insecure-registries` (or
  a `crane --insecure` client); a remote bridge needs TLS (prod Caddy provides it).

## Glossary

Canonical terms (Package, Package version, Content store/CAS, Blob) are defined in
[`../../CONTEXT.md`](../../CONTEXT.md) under **Packages**.
