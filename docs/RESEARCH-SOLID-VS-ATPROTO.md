# Research: Solid vs AT Protocol for "Next-Level Git for Developers and Agents"

> **Date:** 2026-05-26
> **Status:** Revised after adversarial validation pass
> **Author:** Synthesized from three parallel research passes (codebase deep-dive, Solid/CSS spec review, atproto spec review), then revised against an independent verification pass

## TL;DR

The Mind Codespaces v0 prototype already proves that a **Solid Pod can host a developer-tools product's static-site target and identity surface**. It does *not* prove that a Solid Pod is the right place to store git's native object graph at scale, and the gap analysis in `docs/PRODUCTION-READINESS.md` (no reconciler, no multi-host federation, no PR Turtle, no agent budgets) describes exactly the shape of problem that AT Protocol's signed, content-addressed, federated-firehose architecture already solves.

**Recommended architecture: a Tangled-compatible Knot + AppView, with Mind Pages as an orthogonal pod feature.**

This is a deliberate de-scoping of the original "invent our own lexicon" hybrid. The validation pass showed that every record type we needed (`repo`, `refUpdate`, `pull`, `issue`, `collaborator`, `pipeline`) already exists under [`sh.tangled.*`](https://tangled.org/tangled.org/core/blob/master/docs/DOCS.md) and works in production. Forking the lexicon costs us interop with Tangled's AppView and CI (Spindle) and buys us nothing on the product side.

- **Git object store:** bare repos on a knot sidecar, wire-compatible with Tangled's knot model. Mind Codespaces v0's existing `src/lib/git/http-cgi.ts` is the basis — Tangled adds SSH; we'd add the same.
- **Metadata (repo / refUpdate / issue / pull / pipeline):** atproto records under `sh.tangled.*`, written into the user's PDS, signed by the user's signing key, replayed via Jetstream into our indexer. We adopt unchanged. Where we need a Mind-specific extension (e.g. workflow runner config richer than Spindle), we propose it upstream or add a small `dev.mindcode.*` extension only for the truly net-new fields.
- **Identity:** DID-first (`did:web` default for self-host; `did:plc` optional for users who want PLC-recoverable identity). A bridge service hosts both a DID document at `/.well-known/did.json` and a WebID profile so existing Solid clients still work — *two documents at two URLs* with `alsoKnownAs` cross-references (see §4d for why "one document" is not feasible).
- **Agent identity:** atproto OAuth with DPoP. Today this scopes at the **collection / NSID level**, not per-repo — so per-repo agent scoping is a **bridge-issued capability proxy** (we mint a narrowed token, the proxy enforces the rkey constraint). When upstream `permission-set` lexicons mature, we delegate; until then we run the proxy. Be honest about this — it is not free.
- **Notifications / CI triggers:** Jetstream filter on `sh.tangled.git.refUpdate` is the canonical event source. For legacy Solid clients that want per-pod notifications, fan out via WebhookChannel2023.
- **Static-site publishing (Mind Pages):** stays. Triggered by Jetstream on refUpdate. Publishes to the user's Solid Pod's `/public/sites/{repo}/`. This is **orthogonal to the git substrate** — it is a Mind-only value-add over Tangled, not justification for keeping Solid in the git stack.
- **Product differentiation** lives in: Docker-sandboxed workflow runner (`docs/WORKFLOWS-PLAN.md`), agent dispatcher (`src/lib/agents/dispatch.ts`), BYOK provider config, Mind Pages, agent budgets. None of this depends on owning a lexicon.

This pulls each protocol toward what it is good at, refuses to fork a lexicon we don't need, and ships faster.

---

## 1. What we already have (Mind Codespaces v0)

Reference: `docs/IDEA.md`, `docs/PRODUCTION-READINESS.md`, `docs/WORKFLOWS-PLAN.md`, ~23k LOC of TypeScript/React.

| Component | File | What it does |
|---|---|---|
| Smart-HTTP git endpoint | `src/lib/git/http-cgi.ts:46-229` | Spawns `git http-backend` CGI; pipes request body in, parses CGI response, streams to client. 10-minute timeout, child reaping on shutdown. |
| Bare-repo backend | `src/lib/git/backend.ts` | Repos live at `.git-data/repos/{owner}/{name}.git/`. Installs `hooks/post-receive`. |
| Post-receive validator | `src/app/api/git/internal/post-receive/route.ts:42-143` | HMAC-SHA256 verifies hook payload; dispatches workflow runner or legacy publisher. |
| Workflow runner | `src/lib/workflows/runner.ts:50-130` + `docker.ts` | YAML-defined steps; Docker-default (node:22-alpine, --memory=2g, --cap-drop ALL, network none); native fallback for dev. |
| Mind Pages publisher | `src/lib/pages/publisher.ts:78-250` | Walks checkout → PUT files to pod's `/public/sites/{repo}/`, re-asserts public ACL, prunes by parsing `ldp:contains` from previous publish. |
| OIDC delegation | `src/lib/solid/fetch-for-owner.ts` + `auth.ts` | Authorization-code flow → encrypted (AES-256-GCM) refresh token → DPoP-bound access tokens via `@inrupt/solid-client-authn-node`. |
| Pod-side metadata | `src/lib/solid/repo-metadata.ts`, `containers.ts`, `issues.ts` | Turtle resources at `/codespaces/{repo}/index.ttl`, `/issues/{n}/issue.ttl`, etc. SQLite caches in `.registry-data/`. |
| Production topology | `infra/prod/` | Caddy + bridge + CSS + socket-proxy + verdaccio on a Hetzner CX33; live alpha at `codespaces.duckdns.org`. |

**Established gaps** (from `docs/PRODUCTION-READINESS.md`):
- No repo-deletion API.
- Pod-canonical reconciler for issues/comments not built — SQLite is currently the source of truth, pod-side Turtle is best-effort.
- No multi-host federation.
- No pull-request Turtle on the pod.
- No agent budgets (token caps).
- Only 8 unit tests; no Smart-HTTP round-trip, live-CSS publish, OIDC, or concurrent-push integration tests.

These gaps are **the exact shape of what atproto solves natively** (signed canonical record, replayable event stream, per-app OAuth scopes). That observation drives the rest of this document.

---

## 2. Solid as the substrate — strengths and walls

### What Solid is genuinely best-in-class at

- **User-owned writable URL namespace.** A pod is literally an HTTP `PUT`-able tree under the user's control. For "your static site lives in your storage" this is unbeatable — no tenancy negotiation, no app-store, no provider lock-in. This is *exactly* what Mind Pages exploits.
- **Solid-OIDC + Client-ID-as-URL.** Any deployed web app or agent can have a public Client ID document and request access via a vanilla OIDC consent flow. No central client registry. For multi-agent systems this is the killer feature — every agent gets a portable identity for free.
- **Fine-grained per-resource ACL/ACP.** WAC and ACP both express "this folder is readable by world, that folder is writeable by these clients" with very little ceremony.
- **WebID portability.** Move providers, the apps follow.

### Where Solid hits a wall for git-shaped workloads

These are not opinions, they are deliberate omissions in the spec ([Solid Protocol v0.11.0, §5](https://solidproject.org/TR/protocol)):

1. **No transactions, no atomic multi-resource updates.** A git commit touches N files; Solid gives you N HTTP requests. If request 7 of 12 fails, you have a half-applied commit. CSS does not offer a transactional config.
2. **No native versioning, no content addressing.** Resources are last-writer-wins. There is no protocol-level history, branches, tags, or CAS. You'd reimplement loose-object/packfile semantics on top of `/objects/<sha>` PUTs with no dedup across pods.
3. **Concurrency is weak.** `If-Match`/`If-None-Match` are the only optimistic concurrency primitive, and ETags on RDF sources are brittle (semantically equivalent Turtle serializations can differ). Two agents writing the same ref clobber each other unless you build your own lock service.
4. **RDF parsing tax at scale.** Every container listing carries `ldp:contains` triples — fine for a folder with 50 files, painful with 10k. ACL evaluation walks the container chain on every request.
5. **WAC vs ACP fragmentation.** CSS supports both; Inrupt ESS is ACP-only; NSS is WAC-only. No automatic translator. You have to pick.
6. **No first-class delegation.** Solid-OIDC has no narrowed, time-bound, capability-style grant. SAI (Solid Application Interoperability) is the draft answer but is not implemented in CSS. Today, "give this agent write access to repos/foo/ only for the next hour" requires custom infrastructure.
7. **No discoverability across pods.** No global index. Every cross-pod feature needs an app-managed index — which is *exactly* why `mind-codespaces-v0` already maintains a SQLite cache.
8. **Spec is a Draft Community Group Report, not a W3C Recommendation.** Stable enough to ship; unstable enough to surprise.

### Practical takeaway

Solid is the right substrate for **the user-owned URL namespace + portable identity + standardized auth**. It is *not* the right out-of-the-box content store for **git's object graph or for an event stream consumed by many indexers**. The prototype already wisely treats the pod as a thin "metadata + static-site target" layer and keeps git objects in bare repos on the bridge's disk. That instinct is correct.

---

## 3. AT Protocol as the substrate — strengths and walls

### Why atproto looks git-shaped at the bones

From [atproto.com/specs/repository](https://atproto.com/specs/repository):

- **Merkle Search Tree** of records, content-addressed with CIDs. Same shape as a git tree, with deterministic structure regardless of insertion order.
- **Commit objects** with `did`, `version`, `data` (MST root CID), `rev` (TID logical clock), `prev` (previous commit CID), `sig` (signature over DRISL-CBOR serialization). This is **structurally a signed git commit**.
- **CAR v1** export format — single-file content-addressed bundle, conceptually a packfile.
- **Firehose** (`com.atproto.sync.subscribeRepos`) — every commit signed, every consumer can verify, replay, and reindex. Bluesky runs this at 2,000+ events/sec and 232 GB/day.

### Where atproto hits a wall

From the same spec:

1. **"Repositories are intended to store up to single-digit millions records. Beyond that they become unwieldy."** A real codebase with deep history will not fit if you try to model every file/version as a record.
2. **No branching.** The atproto repo is a single linear `rev`-ordered history. Branches, tags, and merges have to live in records *on top of* the repo, not inside the MST.
3. **Blob size caps.** The spec leaves per-blob limits to operators; Bluesky's PDS enforces caps in the low-megabyte range in practice. Note that the widely-cited "5 MB" number is the *firehose WebSocket frame max* ([sync spec](https://atproto.com/specs/sync)), not a documented per-blob ceiling. Either way: real binary assets, LFS-style content, and `node_modules` snapshots are out.
4. **Record/commit hard limits:** 1 MB per record, 2 MB per commit block, 200 ops per commit.
5. **Centralization soft spot.** `https://plc.directory` is operated by Bluesky PBC (transfer to a Swiss Association announced September 2025, in progress). `did:web` escapes this at the cost of losing the recovery story.
6. **Self-hosting friction.** Field reports describe PDS self-hosting as doable but rough; account migration is "potentially destructive — if something goes wrong, you could be permanently locked out."
7. **Custom-lexicon adoption is socially unsolved.** No formal review process for third-party lexicons; resolution tooling is incomplete; ecosystem fragmentation is real ([discussion 3338](https://github.com/bluesky-social/atproto/discussions/3338)).

### The existence proof: Tangled

[Tangled](https://docs.tangled.org/single-page) ships a git-host built on atproto today, and the architecture is exactly the synthesis our research lands on:

- A **"Knot"** is an atproto-aware git server. Bare repos live as ordinary `did:plc:.../reponame/` directories on the knot's filesystem ([Anil Madhavapeddy walkthrough](https://anil.recoil.org/notes/disentangling-git-with-bluesky)).
- Knot ownership is asserted by writing a `sh.tangled.knot` record to the user's PDS.
- Push flow: SSH push → knot stores objects locally → knot writes `sh.tangled.git.refUpdate` to the user's PDS → AppView at `tangled.org` indexes via Jetstream.
- Collab records: `sh.tangled.repo`, `.repo.pull`, `.repo.issue`, `.repo.collaborator`, `.pipeline`.
- Federation comes for free: a PR from `alice.knot.a` to `bob.knot.b` is two atproto records pointing at each other; the AppView reconciles.

This is, almost line-for-line, the architecture this document recommends.

---

## 4. Side-by-side comparison

| Dimension | Solid | AT Protocol | Winner for "git for devs and agents" |
|---|---|---|---|
| User-owned writable URL space | First-class (pods are HTTP-PUT trees) | Not the model (records are CBOR in MST) | **Solid** — keep for static-site target |
| Portable identity across hosts | WebID + Solid-OIDC | DID + `did:plc`/`did:web` + signing keys | **atproto** — DID recovery + migration is more mature |
| Per-agent authorization | Client-ID-as-URL (great); SAI scopes draft | OAuth + DPoP + draft `permission-set` lexicons | **Tie** — both maturing; atproto is more uniform; Solid Client-ID-as-URL is more elegant |
| Content addressing | None at protocol layer | Native (CIDs, MST, CAR) | **atproto** |
| Signed commits | None | Native, every commit | **atproto** |
| Atomic multi-resource writes | None | A commit *is* an atomic batch (≤200 ops, ≤2 MB) | **atproto** |
| Branching / git DAG semantics | None | Linear `rev` history, no branches | **Neither** — both require sidecar git, Tangled-style |
| Large binary blobs | First-class (PUT any media type, any size) | 5 MB blob caps in practice | **Solid** |
| Federation / event stream | Notifications spec (per-pod subscribe) | Firehose / Jetstream (global, partitionable) | **atproto** |
| Self-host story | CSS is mature, easy to run | PDS self-host is rough but real | **Solid** (today) |
| Spec stability | Draft CG Report | Working spec, repo v3 stable | **Tie** — both pre-recommendation |
| Production scale evidence | SolidLab/Inrupt deployments | Bluesky: 40M users, 232 GB/day firehose | **atproto** |
| ACL granularity | WAC/ACP (very fine) | Lexicon-typed permission-sets (coarser) | **Solid** |
| RDF / semantic web interop | Native | Not the model | **Solid** |
| Tooling / SDKs | `@inrupt/solid-client`, niche | `@atproto/api`, Indigo (Go), millipds (Py), broad | **atproto** |

---

## 5. The recommended architecture — "Mind Codespaces v1"

```
                  ┌──────────────────────────────────────┐
                  │   Developer or Agent (CLI / IDE)     │
                  │  • git push over Smart HTTP/SSH      │
                  │  • atproto OAuth (DPoP) via bridge   │
                  └──────────────┬───────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────────┐  ┌────────────────────┐  ┌──────────────────────┐
│  Mind Knot        │  │  User's PDS        │  │  User's Solid Pod    │
│  (Tangled-compat) │  │  (atproto records) │  │  (Mind Pages target  │
│                   │  │                    │  │   + private data)    │
│  bare repos at    │  │  sh.tangled.*      │  │                      │
│  did:.../{repo}.git│  │  • repo            │  │  /public/sites/{r}/  │
│                   │  │  • git.refUpdate   │  │  /private/...        │
│  push hook writes │  │  • repo.pull       │  │                      │
│  refUpdate to PDS │  │  • repo.issue      │  │  WebID profile +     │
│  (transactionally)│  │  • pipeline        │  │  did:web alsoKnownAs │
└───────────────────┘  └────────┬───────────┘  └──────────────────────┘
                                │
                                ▼
                  ┌─────────────────────────────┐
                  │  Jetstream filter           │
                  │  (sh.tangled.* events)      │
                  └──────────────┬──────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────────┐  ┌────────────────────┐  ┌──────────────────────┐
│  Mind AppView     │  │  CI Trigger Svc    │  │  Mind Pages           │
│  (UI, search, PR  │  │  (queues workflow  │  │  Publisher Svc        │
│   list, dashboard)│  │   runs in Docker)  │  │  (PUT files to pod)   │
│                   │  │                    │  │                       │
│  also indexes     │  │                    │  │  Mind-only feature;   │
│  Tangled events!  │  │                    │  │  orthogonal to git.   │
└───────────────────┘  └────────────────────┘  └──────────────────────┘
```

### Mapping each concern

| Concern | Where it lives | Why |
|---|---|---|
| Git objects (blobs/trees/commits) | **Knot bare repo on disk** (Tangled-compatible layout) | Spec-correct (atproto repos can't hold git's object graph); Mind Codespaces v0's `http-cgi.ts` ports straight over. Wire compat means Tangled tooling works. |
| User identity | **DID + WebID dual-publish** | `did:web` for self-host, `did:plc` optional. Bridge serves *both* `/.well-known/did.json` and a WebID profile; the DID doc's `alsoKnownAs` points to the WebID URI. Existing Solid auth flows continue to work. |
| Repo metadata | **`sh.tangled.repo`** in user's PDS | Adopt unchanged. SQLite `repos` table becomes a Jetstream-derived index. |
| Ref updates | **`sh.tangled.git.refUpdate`** in user's PDS | Signed by user, replayable, portable. The knot writes this *inside* the git ref-lock window — if the PDS write fails, the git ref-update aborts (we extend Tangled's pattern here to harden CI consistency; see §6). |
| Issues / PRs / comments | **`sh.tangled.repo.issue` / `.repo.pull`** | Solves the reconciler gap by construction. PDS is canonical; SQLite is a derived index. |
| Pipeline run definitions | **`sh.tangled.pipeline`** (extend if needed) | Tangled's Spindle lexicon is the starting point; our richer Docker runner spec may need a `dev.mindcode.pipeline.workflow` extension. |
| Pipeline logs | **Knot-local file** + summary record | Logs are bulky; reference via URL from the record. |
| Published static site | **Solid Pod** (`/public/sites/{repo}/`) | Pods are the user-owned writable URL space. The publisher (`src/lib/pages/publisher.ts`) keeps working — only its trigger source changes (Jetstream instead of HMAC hook). |
| Private notes / drafts | **Solid Pod** (WAC-locked container) | Anything not meant for the firehose stays in the pod. |
| Agent credentials | **atproto OAuth + bridge-issued capability proxy** | atproto OAuth scopes at the collection level today, not per-repo. The bridge mints a narrowed proxy credential that constrains `rkey` to a specific repo for a specific TTL. Migrate to native `permission-set` lexicons when they ship. |
| Push triggers (CI, deploy) | **Jetstream filter on `sh.tangled.git.refUpdate`** | Single global event bus. Backfill via `seq` cursor. |
| Cross-bridge federation | **Free** via Jetstream/Relay | A PR from another knot to ours is two records pointing at each other; the AppView reconciles. Bonus: we interoperate with Tangled's user base on day one. |

### What this *removes* from Mind Codespaces v0

- The bespoke HMAC post-receive hook becomes a thin "write a `refUpdate` record" call. Trust shifts to the atproto signature.
- The SQLite "pod-canonical reconciler" gap (P2 in `PRODUCTION-READINESS.md`) disappears — the PDS *is* canonical; SQLite is rebuilt from Jetstream replay.
- The OIDC-issuer allowlist (P2: "no multi-host federation") goes away — DIDs are global, no per-deployment allowlist needed.
- The custom push-token mechanism is replaced by atproto OAuth.

### What this *keeps* from Mind Codespaces v0

- The Smart-HTTP git-http-backend CGI endpoint (it's spec-correct git).
- The Docker workflow runner (the threat model in `WORKFLOWS-PLAN.md` is sound).
- The Mind Pages publisher (and the pod as publish target).
- The bridge's reverse-proxy/Caddy/socket-proxy production topology.
- The agent dispatch model (`src/lib/agents/dispatch.ts`) — only its identity primitives change.

### Migration path from v0

1. Stand up the knot service wrapping the existing `http-cgi.ts`. Write `sh.tangled.git.refUpdate` records on push — *inside the ref-lock window*, with a rollback path if the PDS write fails (see §6 two-writes risk).
2. Add a `did:web` identity backend alongside the existing WebID/OIDC backend. Publish both documents at well-known paths; cross-reference via `alsoKnownAs`.
3. Build the Mind AppView: a Jetstream consumer that indexes `sh.tangled.*` events into the existing SQLite registry. Flip write direction so PDS is canonical, SQLite is derived. This also gives us Tangled repos in our dashboard for free.
4. Replace push-token Basic Auth with atproto OAuth + bridge-issued per-repo capability proxy.
5. Keep the Mind Pages publisher unchanged — only its trigger source changes (Jetstream filter on `sh.tangled.git.refUpdate` instead of HMAC post-receive).
6. Track upstream: when atproto `permission-set` lexicons mature, delegate the capability proxy. When Tangled extends pipeline lexicons, adopt or contribute extensions.

**Only fork to `dev.mindcode.*`** if a needed record shape has no Tangled equivalent and upstream rejects the contribution. Forking is the contingency, not the plan.

---

## 6. Honest risks and open questions

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Two-writes consistency** (refUpdate ↔ git push) | The knot must store git objects *and* write a `refUpdate` to the PDS. If the PDS write fails after git accepts the push, indexers and CI never see the event; clones work, deploys don't. Tangled's design hides this — we'd inherit the bug. | Treat the PDS write as part of git's ref-update transaction: write the record *before* releasing git's per-ref lock; on PDS failure, run `git update-ref -d` to roll back. Plus a periodic reconciler walking refs ↔ records as a safety net. Accept "eventually-consistent CI triggers" as the failure mode; document it. |
| **atproto OAuth scope is collection-level, not per-repo** | We can scope an agent to "write `sh.tangled.git.refUpdate` records" but not "only on this one repo." Today and likely for the foreseeable future ([GH #4437](https://github.com/bluesky-social/atproto/discussions/4437)). | Run a bridge-issued capability proxy that holds the collection-scoped token and enforces the per-repo rkey constraint on each request. This is non-trivial infra — not "set a scope and forget." |
| **`did:web` ↔ WebID interop requires two documents** | The doc originally framed this as a single profile document with `solid:oidcIssuer`. That's not how either format works. | Publish *two* documents at two well-known URLs (`/.well-known/did.json` and the WebID profile), cross-linked via `alsoKnownAs` and the WebID's `solid:oidcIssuer`. Acknowledge the bridge service. |
| **Lexicon ecosystem fragmentation** | If we fork to `dev.mindcode.*` we lose Tangled interop. If Tangled disappears we're stuck with their lexicons. | Adopt `sh.tangled.*` unchanged; contribute extensions upstream; only fork if upstream rejects. The doc was previously too cavalier about owning a lexicon. |
| **PLC centralization** | `plc.directory` is Bluesky-operated until the Swiss Association transfer completes (announced 2025-09-19, in progress). | Default to `did:web` for self-hosted Mind Knots; offer `did:plc` only for users who want PLC's recovery features. |
| **Blob size caps** | Bluesky-style PDSes enforce low-MB blob caps; binary commit content can't ride in atproto records. | Keep binaries on the knot; atproto only carries refs and metadata. (This is exactly Tangled's model.) Note: the often-cited "5 MB cap" is actually the firehose frame max, not a documented blob cap — but the practical limit is real. |
| **Mind Pages dependency on pod ACL behaviour** | The publisher re-asserts public-read ACL on every publish to defend against drift. Different Solid backends handle WAC differently (CSS vs. NSS vs. ESS). | Pin a tested Solid backend matrix; document the WAC requirements; consider shipping a Mind-hosted CSS preset. |
| **Solid Notifications vs. Jetstream split** | Some Solid-native clients expect per-pod notification subscriptions. | Run a thin fanout: Jetstream → WebhookChannel2023 per repo subscription. Treat as a legacy compatibility shim. |
| **Account migration is destructive if mishandled** | Real PDS migration today carries lock-out risk ([Buchanan's adversarial PDS analysis](https://www.da.vidbuchanan.co.uk/blog/adversarial-pds-migration.html)). | Don't expose primary-account migration until we have a hardened wizard; document the 72-hour PLC recovery window. |
| **Spec drift** | Both Solid (Draft CG Report) and atproto (working spec) are pre-recommendation. | Pin to spec versions; run lexicon evolution rules strictly (only additive fields); version our NSIDs from day one. |

---

## 7. Alternatives we considered and rejected

| Alternative | Why it's interesting | Why we don't pick it |
|---|---|---|
| **Pure Solid** | We've already shipped most of it. | Forces us to invent commits, content-addressing, atomic batches, federation, and an event stream — all things atproto gives for free. Every P1/P2 gap in `PRODUCTION-READINESS.md` is one of these. |
| **Pure atproto (no pod)** | Maximum federation, minimum infra. | Loses the user-owned URL namespace for static sites. Mind Pages becomes harder, not easier. We'd need to invent it on AppView-rendered pages. |
| **Fork our own lexicon (`dev.mindcode.*`)** | Full control over the schema. | Two ecosystems, no Tangled interop, indexer fragmentation. Every shape we need (`repo`, `refUpdate`, `pull`, `issue`, `pipeline`) already exists under `sh.tangled.*`. No product reason to fork. |
| **[ForgeFed](https://forgefed.org/) on Forgejo** | Federation between forges via ActivityPub. Alive but experimental: federated stars shipped 2025, federated PRs still in dev. | ForgeFed federates *forges*; atproto federates *users*. Our agent-identity bet is on user-rooted DIDs that follow developers across hosts, which atproto fits better. Also: ForgeFed today is "experimental, expect breaking changes." |
| **[Radicle](https://radicle.xyz)** | Peer-to-peer git with cryptographic identities and gossip. The most credible technical alternative. v1.9.1 (2026), ~8000 repos, ~600 active nodes/week. | Tiny user pool (orders of magnitude smaller than Bluesky), no agent-OAuth story, no obvious bridge to a user's writable URL namespace. Worth revisiting in 2 years. |
| **[nostr NIP-34](https://github.com/nostr-protocol/nips/blob/master/34.md)** (git-via-nostr) | Signed events on relays, conceptually overlapping atproto. Tools like `ngit` exist. | Smaller dev ecosystem; relay-based model is weaker for high-volume indexing than the firehose; no equivalent of the AppView pattern. |
| **IPFS as the object store** | Content-addressed by design. | Git's object format is already content-addressed; an IPFS layer adds operations (pinning, gateways) and complexity for negligible gain at single-knot scale. |
| **Self-hosted Forgejo + OIDC plugin** | Boring, works today, mature CI, packages, releases. The elephant in the room. | Forgejo's identity model is forge-centred; our thesis is user-rooted identity portable across hosts. Forgejo's federation is incomplete; its agent-OAuth story is "fine-grained PATs" which is solid but conventional. The atproto bet pays off *only* if we believe portable user identity matters more than mature forge features — which is the whole `mind-*` thesis. |

## 8. The thesis

> A git remote that is **federated by signed events**, **identified by portable DIDs**, **observable by anyone with a firehose consumer**, **publishable into the user's own URL namespace**, and **writable by AI agents holding scoped, DPoP-bound, bridge-mediated capabilities** — without any one company owning the namespace, the index, or the credential store.

Mind Codespaces v0 has built ~70% of the user-facing surface. **The remaining 30% is not "build the atproto layer ourselves" — it is "become wire-compatible with Tangled, add the Mind-specific runner and Pages, and ship."** That is a smaller, faster, lower-risk move than the original hybrid sales pitch, and it gets us into a working federation on day one.

---

## 9. References

### Primary sources
- [Solid Protocol v0.11.0](https://solidproject.org/TR/protocol)
- [Solid-OIDC v0.1.0](https://solidproject.org/TR/oidc)
- [Web Access Control](https://solid.github.io/web-access-control-spec/)
- [Solid Notifications Protocol v0.3.0](https://solidproject.org/TR/notifications-protocol)
- [Community Solid Server](https://github.com/CommunitySolidServer/CommunitySolidServer)
- [AT Protocol overview](https://atproto.com)
- [Repository spec (MST, CAR, commits)](https://atproto.com/specs/repository)
- [DID spec (did:plc, did:web)](https://atproto.com/specs/did)
- [Lexicon spec](https://atproto.com/specs/lexicon)
- [Sync spec / firehose](https://atproto.com/specs/sync)
- [OAuth spec](https://atproto.com/specs/oauth)
- [bluesky-social/atproto](https://github.com/bluesky-social/atproto)

### Existence proof for the hybrid
- [Tangled docs](https://docs.tangled.org/single-page)
- [Tangled core DOCS.md](https://tangled.org/tangled.org/core/blob/master/docs/DOCS.md) — full lexicon list, knot architecture
- [Tangled intro blog](https://blog.tangled.org/intro/)
- [Anil Madhavapeddy: Disentangling git with Bluesky](https://anil.recoil.org/notes/disentangling-git-with-bluesky)
- [Embracing ATProto pt.2 — Tangled knot](https://finxol.io/posts/embracing-atproto-pt-2-tangled-knot/)

### Alternatives surveyed and rejected
- [ForgeFed protocol](https://forgefed.org/)
- [Forgejo federation FAQ](https://forgejo.org/faq/)
- [Radicle](https://radicle.dev/)
- [LWN: Radicle](https://lwn.net/Articles/966869/)
- [nostr NIP-34 (git via nostr)](https://github.com/nostr-protocol/nips/blob/master/34.md)
- [ngit-relay (git + Blossom on nostr)](https://ngit.dev/relay/)

### atproto OAuth scope status
- [atproto.com/guides/permission-sets](https://atproto.com/guides/permission-sets)
- [GH discussion #4437 — Early Permission Sets](https://github.com/bluesky-social/atproto/discussions/4437)
- [GH discussion #4118 — Progress on Auth Scopes (Aug 2025)](https://github.com/bluesky-social/atproto/discussions/4118)

### Critical reading
- [Adversarial PDS Migration — David Buchanan](https://www.da.vidbuchanan.co.uk/blog/adversarial-pds-migration.html)
- [Risks of did:plc — Agent IO](https://agent.io/posts/risks-of-did-plc/)
- [Rethinking Bluesky's decentralization (Jan 2026)](https://plurality.leaflet.pub/3mfergx7i7c2b)
- [Solid forum: Hybrid Solid + atproto + ActivityPub](https://forum.solidproject.org/t/exploring-a-hybrid-protocol-stack-solid-at-protocol-activitypub/8252)
- [Assessing the Solid Protocol — Esposito et al.](https://arxiv.org/abs/2210.08270)

### Internal references
- `docs/IDEA.md` — Mind Codespaces vision
- `docs/PRODUCTION-READINESS.md` — gap analysis
- `docs/WORKFLOWS-PLAN.md` — runner threat model
- `src/lib/git/http-cgi.ts:46-229` — Smart-HTTP implementation
- `src/lib/pages/publisher.ts:78-250` — Mind Pages publisher
- `src/lib/solid/fetch-for-owner.ts` — OIDC delegation
