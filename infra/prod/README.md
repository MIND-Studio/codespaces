# mind-codespaces — production deployment

Single-VM Docker Compose stack: Caddy (TLS) → Bridge (Next.js) + CSS (Solid pod server). Designed for a small cloud VM (2 vCPU / 4 GB RAM minimum) hosting **public Solid pods** with a GitHub-style git frontend.

---

## ⚠ Read before exposing to the open internet

This compose **wires the deployment**. It does **not** ship the full security floor. The following items from [`docs/PRODUCTION-READINESS.md`](../../docs/PRODUCTION-READINESS.md) are still open and matter the moment DNS points at the VM:

| Item | Why it bites in public |
|---|---|
| **P0-S1** — every API route is unauthenticated | Anyone on the internet can create repos, mint push tokens, dispatch agents. |
| **P0-S2** — seeded-credential fallback | Mitigated here by leaving `POD_USER_EMAIL`/`POD_USER_PASSWORD` unset; verify on first boot that no log line says `auth mode: seeded`. |
| **P0-S3** — loopback hook is unauthenticated | Anyone who can reach `/api/git/internal/post-receive` can re-trigger publishes. Caddy doesn't fix this — the route's still exposed via the same vhost. |
| **P0-R3** — orphaned `git http-backend` processes | On a public endpoint with crawlers and aborted clones, leaks fds. |

**Recommended minimum gating until those land:** put **basic auth in front of `/api/*`** in the Caddyfile, or restrict the bridge to a VPN/Tailscale interface. The Caddy snippet:

```caddy
{$MIND_DOMAIN_BRIDGE} {
    basicauth /api/* {
        admin <bcrypt-hash-here>   # caddy hash-password
    }
    # ... reverse_proxy as below
}
```

The CSS host (`pod.<domain>`) is meant to be open — that's a public pod server.

---

## 1. Prereqs on the VM

- Ubuntu / Debian (anything recent), with **Docker Engine + Compose v2** installed (`docker compose version` should report ≥ 2.20).
- The user you deploy as is in the `docker` group (`groups | grep docker`).
- Two DNS A records pointing at the VM's public IP **before** first `docker compose up` — Caddy will fail ACME issuance otherwise:
  - `codespaces.<your-domain>` → bridge
  - `pod.<your-domain>` → CSS
- Ports `80`, `443` (TCP+UDP) open in your VM firewall / cloud SG.

## 2. Get the code on the VM

```bash
git clone <your-fork-or-this-repo> /opt/mind-codespaces
cd /opt/mind-codespaces/mind-codespaces-v0/infra/prod
```

(The path doesn't matter; this README assumes `/opt/mind-codespaces/`.)

## 3. Configure

```bash
cp .env.example .env
$EDITOR .env
```

Fill in:

- `MIND_DOMAIN_BRIDGE` and `MIND_DOMAIN_POD` — your two hostnames.
- `ACME_EMAIL` — Let's Encrypt notification address.
- `OPENROUTER_API_KEY` — optional bridge-wide fallback for the coder. Leave blank if every owner brings their own key via `/profile/ai-providers` (BYOK). Anyone with shell access to the bridge can read this var, so BYOK is preferred in shared deployments; set this only when you want a default for owners who haven't configured BYOK.
- `MIND_CODER_IMAGE` — after step 5 below, replace `:latest` with the SHA digest of the image you built. Strongly recommended for prod.

## 4. Prepare host directories

```bash
sudo mkdir -p /var/lib/mind/coder-work /var/lib/mind/agent-logs
sudo chown 1000:1000 /var/lib/mind/coder-work /var/lib/mind/agent-logs
```

`uid 1000` is the `node` user inside the bridge image. Both `coder-work` and `agent-logs` are host bind mounts that need this explicit chmod — the other volumes are docker-named and self-managed.

## 5. Build the coder sandbox image

The coder driver shells out to `docker run mind-codespaces/coder:latest`. That image isn't on Docker Hub; build it locally once:

```bash
cd /opt/mind-codespaces/mind-codespaces-v0
docker build -t mind-codespaces/coder:latest infra/coder
```

The workflow runner also pulls `node:22-alpine` on first use (~150 MB) — pre-pull it if you want a faster first agent run:

```bash
docker pull node:22-alpine
```

## 6. Start the stack

```bash
cd /opt/mind-codespaces/mind-codespaces-v0/infra/prod
docker compose --env-file .env up -d --build
```

The bridge image builds on this VM (Next.js standalone bundle, ~200 MB). First boot:
- Caddy negotiates Let's Encrypt for both hostnames (~30 s).
- CSS initialises its data dir.
- The bridge runs database migrations against the fresh SQLite volume.

## 7. Verify

```bash
# Caddy got certs
curl -I https://${MIND_DOMAIN_BRIDGE}

# Bridge is up
curl -s https://${MIND_DOMAIN_BRIDGE}/api/health

# CSS is up and serves its public landing page
curl -I https://${MIND_DOMAIN_POD}/

# Logs — watch for errors during agents bootstrap
docker compose logs -f bridge
```

Open `https://<MIND_DOMAIN_POD>/idp/register/` in a browser to create the first public pod. Your WebID will be `https://<MIND_DOMAIN_POD>/<username>/profile/card#me`.

## 8. Day-2

**Logs:**
```bash
docker compose logs -f bridge   # request log + agent runs
docker compose logs -f css      # pod server
docker compose logs -f caddy    # TLS + access log
```

**Updates — manual (build on VM):**
```bash
git pull
docker compose --env-file .env up -d --build bridge
# CSS and Caddy don't change unless their image tags change.
```

**Updates — via CI (registry-pulled, recommended):**

Push a `v*` tag and `.github/workflows/deploy.yml` will build the bridge image, push it to GHCR, then SSH here and roll the stack onto the new digest. See the workflow header for the repo secrets it needs (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, optionally `DEPLOY_PORT`, `DEPLOY_DIR`).

The workflow uses `docker-compose.prod.yml` as an override that replaces the bridge `build:` with a digest-pinned `image:` reference — so two compose files are in play whenever you run compose by hand against a CI-deployed stack:

```bash
export MIND_BRIDGE_IMAGE='ghcr.io/<owner>/<repo>-bridge@sha256:...'  # see the last deploy log
docker compose --env-file .env \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  ps
```

**First-time VM bootstrap:**

`scripts/bootstrap-vm.sh` automates steps 1–6 above (install Docker, clone the repo, generate the three required secrets, build the coder image, start the stack). Idempotent — re-runs are safe:

```bash
REPO_URL=https://github.com/<you>/mind-codespaces.git ./scripts/bootstrap-vm.sh
```

**Backups (what to back up):**
- The `css_data` named volume — the user pods. Most important.
- The `bridge_registry` named volume — SQLite (repos, tokens, identities, issues).
- The `bridge_git_data` named volume — bare git repos.
- The `caddy_data` named volume — TLS keys & certs (regeneratable, but Let's Encrypt has rate limits).

```bash
docker run --rm -v mind-codespaces_css_data:/data -v $(pwd):/backup \
    busybox tar czf /backup/css-$(date +%F).tgz -C /data .
# repeat for the other three volumes
```

**Restart everything cleanly:**
```bash
docker compose restart
```

**Tear down (keeps volumes):**
```bash
docker compose down
```

**Tear down everything including data (DESTRUCTIVE):**
```bash
docker compose down -v   # ← deletes all pods, all repos, all certs
```

---

## Trust model — the Docker socket

The bridge **does not** mount `/var/run/docker.sock`. All Docker API calls from the bridge go through the `socket-proxy` service (`tecnativa/docker-socket-proxy`), which sits between the bridge and the real socket and filters the API down to the verbs we actually need.

What the proxy allows:

| Verb + endpoint | Why we need it |
|---|---|
| `POST /containers/create` | Spawn the coder + workflow runner containers |
| `POST /containers/{id}/start` | Run them |
| `POST /containers/{id}/wait` | Wait for them to exit |
| `GET /containers/{id}/logs` | Capture stdout/stderr |
| `DELETE /containers/{id}` | `--rm` cleanup |
| `GET /images/{name}/json` | Confirm the coder image exists before run |

What it blocks (everything else, by explicit `*=0` envs in `docker-compose.yml`):

- `POST /containers/{id}/exec` — would let an attacker `docker exec` into other running containers.
- `POST /build` — would let an attacker build an image, including FROM-scratch with arbitrary contents.
- `POST /networks/*`, `POST /volumes/*` — would let an attacker create attack-shaped networks/volumes.
- `/swarm/*`, `/secrets/*`, `/plugins/*`, `/system/*`, `/configs/*` — anything that touches daemon-wide state or leaks host metadata.

**Residual risk you should know about.** The proxy filters by URL + verb only — it does **not** deep-inspect request bodies. A fully compromised bridge can still call `POST /containers/create` with `HostConfig.Privileged: true` or `HostConfig.Binds: ["/:/host"]` and break out. The real defenses for that:

1. **Don't let the bridge be compromised in the first place.** That's what the unauth-route fixes in `PRODUCTION-READINESS.md` §2.1 are for — the proxy doesn't help if anyone on the internet can drive the bridge into running arbitrary agents.
2. **Pin `MIND_CODER_IMAGE` by SHA digest.** Stops a registry compromise from silently swapping the sandbox image. The `.env.example` notes how to get the digest.
3. **Move to rootless Podman / Sysbox / Firecracker** for the agent runs (see `PRODUCTION-READINESS.md` §5). With a rootless runtime, even full daemon-API access doesn't yield host root.

**What the proxy does NOT change:**
- The bridge container itself runs as uid 1000 (the `node` user).
- Coder + workflow containers are still spawned with `--memory=1g --cpus=1` and a bind mount to the per-run work dir.
- Coder containers still have full network egress — opencode needs to reach OpenRouter. `--network none` + a Verdaccio mirror is the readiness-doc follow-up.

---

## File map

| File | Purpose |
|---|---|
| `docker-compose.yml` | Service definitions: caddy, bridge, socket-proxy, css. |
| `Caddyfile` | TLS + reverse-proxy config. |
| `Dockerfile.bridge` | Multi-stage Next.js standalone build. |
| `.dockerignore` | Keeps the build context small. |
| `.env.example` | Template for the populated `.env`. |
| `README.md` | This file. |
