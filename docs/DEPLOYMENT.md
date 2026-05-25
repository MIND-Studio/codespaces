# Deployment — alpha on Hetzner CX33

Live alpha state, access patterns, and operational runbook for the
mind-codespaces-v0 prototype as deployed 2026-05-25.

For the architectural shape (security floor, compose layout, env vars),
see [`infra/prod/README.md`](../infra/prod/README.md) and
[`PRODUCTION-READINESS.md`](./PRODUCTION-READINESS.md).

---

## Resume in a new session

Cold-start checklist when you (or a future Claude session) comes back to
this prototype:

```bash
# 1. Verify SSH access (alias is in ~/.ssh/config; key is dedicated)
ssh mind-codespaces 'docker compose -f /opt/mind-codespaces/infra/prod/docker-compose.yml --env-file /opt/mind-codespaces/infra/prod/.env ps'

# 2. Verify the alpha is still answering
curl -fsS https://codespaces.duckdns.org/api/health

# 3. Verify your local checkout matches the VM (in case you've forgotten
#    which changes were rsync'd but never committed). Both directions:
rsync -avzn --delete \
  --exclude='node_modules/' --exclude='.next/' \
  --exclude='.css-data/' --exclude='.git-data/' --exclude='.registry-data/' \
  --exclude='.env' --exclude='.env.local' --exclude='.env.production' \
  --exclude='.git/' --exclude='.DS_Store' --exclude='*.log' --exclude='*.pem' \
  --exclude='.playwright-mcp/' --exclude='*.tsbuildinfo' --exclude='*.png' \
  ./ mind-codespaces:/opt/mind-codespaces/   # `-n` = dry run; shows drift
```

**Critical caveat — there is no git remote.** The repo isn't under git
locally and isn't on GitHub. The canonical state lives in two places:

1. **Your laptop** (`~/develop/mind/mind-prototypes/mind-codespaces-v0/`) — where edits happen.
2. **The VM** (`/opt/mind-codespaces/`) — where what's running came from.

If your laptop dies, pull from the VM:

```bash
rsync -avz \
  --exclude='.git-data/' --exclude='.registry-data/' --exclude='.css-data/' \
  --exclude='.env' --exclude='node_modules/' --exclude='.next/' \
  mind-codespaces:/opt/mind-codespaces/ ~/develop/mind/mind-prototypes/mind-codespaces-v0/
```

To make this safer, put the prototype in a git repo (private GitHub or self-hosted) — see "What is NOT done yet" below. Until then, the docs you're reading + the laptop + the VM are the only three copies of the codebase.

### One-time loose ends to close before stepping away

- [ ] **Move the rotated root password into your password manager.** It currently lives at `~/.mind-codespaces-root-pw.tmp` (chmod 600). After saving, `shred -u ~/.mind-codespaces-root-pw.tmp`. The password's only use is Hetzner web-console recovery (SSH-as-root is disabled).
- [ ] **Add a passphrase to the SSH key.** `ssh-keygen -p -f ~/.ssh/id_ed25519_mind_codespaces`, then `ssh-add --apple-use-keychain ~/.ssh/id_ed25519_mind_codespaces`.
- [ ] **Init git + push to GitHub.** Without a remote, code edits + the deploy workflow live nowhere off your laptop.

---

## What is running, where

| Layer | Where | Details |
|---|---|---|
| VM | Hetzner Cloud CX33 | 4 vCPU / 8 GB RAM / 80 GB disk · IPv4 `37.27.80.161` · IPv6 `2a01:4f9:c013:bb65::/64` · server name `mind-codespaces` |
| DNS | DuckDNS (free) | `codespaces.duckdns.org` → bridge · `codespaces-pod.duckdns.org` → CSS |
| TLS | Caddy + Let's Encrypt | Auto-renews. First-issuance burned 2 ACME validation attempts (DNS misconfig). |
| Public URLs | `https://codespaces.duckdns.org/` (bridge) · `https://codespaces-pod.duckdns.org/` (Solid pods) |
| Operator account | `deploy@37.27.80.161` (uid 1000, passwordless sudo, in `docker` group) |
| Root account | SSH-disabled. Out-of-band recovery only via Hetzner web console. |
| Code on VM | `/opt/mind-codespaces/` · rsync'd snapshot (no git remote yet) |
| Compose stack | `/opt/mind-codespaces/infra/prod/docker-compose.yml` · 5 services: caddy / bridge / css / socket-proxy / verdaccio |
| Bridge data | `mind-codespaces_bridge_registry` (SQLite) · `mind-codespaces_bridge_git_data` (bare repos) — both docker named volumes |
| Pod data | `mind-codespaces_css_data` — docker named volume |

---

## How to access

### From your laptop

SSH config alias is already set in `~/.ssh/config`:

```bash
ssh mind-codespaces                          # → deploy@37.27.80.161 with the dedicated key
ssh mind-codespaces 'docker ps'              # one-shot remote command
```

Key is at `~/.ssh/id_ed25519_mind_codespaces`. **Add a passphrase** if you haven't yet:

```bash
ssh-keygen -p -f ~/.ssh/id_ed25519_mind_codespaces
ssh-add --apple-use-keychain ~/.ssh/id_ed25519_mind_codespaces
```

### On the VM

```bash
cd /opt/mind-codespaces/infra/prod   # always cd here before docker compose commands
docker compose --env-file .env ps    # service status
```

The `--env-file .env` is **mandatory** for every compose command on this host because the compose file references `${MIND_DOMAIN_BRIDGE}` etc. — without it, compose will refuse to start any service.

---

## Common operations

### Tail logs (everything)

```bash
ssh mind-codespaces 'cd /opt/mind-codespaces/infra/prod && docker compose --env-file .env logs -f'
```

### Tail one service

```bash
ssh mind-codespaces 'cd /opt/mind-codespaces/infra/prod && docker compose --env-file .env logs -f bridge'
# bridge | caddy | css | socket-proxy | verdaccio
```

### Restart a single service

```bash
ssh mind-codespaces 'cd /opt/mind-codespaces/infra/prod && docker compose --env-file .env restart bridge'
```

### Push code changes from your laptop (no GitHub yet)

```bash
# From mind-codespaces-v0/ on your laptop.
# Specific .env excludes (NOT --exclude=.env*; that would eat .env.example):
rsync -avz --delete \
  --exclude='node_modules/' --exclude='.next/' \
  --exclude='.css-data/' --exclude='.git-data/' --exclude='.registry-data/' \
  --exclude='.env' --exclude='.env.local' --exclude='.env.production' \
  --exclude='.git/' --exclude='.DS_Store' --exclude='*.log' --exclude='*.pem' \
  --exclude='.playwright-mcp/' --exclude='*.tsbuildinfo' --exclude='*.png' \
  ./ mind-codespaces:/opt/mind-codespaces/

# Rebuild + redeploy bridge (other services don't change on code-only rsyncs)
ssh mind-codespaces 'cd /opt/mind-codespaces/infra/prod && \
  docker compose --env-file .env build bridge && \
  docker compose --env-file .env up -d bridge'
```

### Read .env on the VM

```bash
ssh mind-codespaces 'cat /opt/mind-codespaces/infra/prod/.env'
```

Secrets were generated on the VM during bootstrap; they were never on the laptop. If you need the admin or metrics token (e.g. to curl `/api/admin/reconcile`), grep for them above.

### Manual reconcile (HEAD → published-SHA drift)

```bash
ssh mind-codespaces 'cd /opt/mind-codespaces/infra/prod && \
  TOK=$(grep ^BRIDGE_ADMIN_TOKEN= .env | cut -d= -f2) && \
  curl -fsS -H "Authorization: Bearer $TOK" -X POST https://codespaces.duckdns.org/api/admin/reconcile'
```

### Scrape Prometheus metrics

```bash
ssh mind-codespaces 'cd /opt/mind-codespaces/infra/prod && \
  TOK=$(grep ^BRIDGE_METRICS_TOKEN= .env | cut -d= -f2) && \
  curl -fsS -H "Authorization: Bearer $TOK" https://codespaces.duckdns.org/api/metrics'
```

### Backup the four data volumes

```bash
ssh mind-codespaces 'for v in css_data bridge_registry bridge_git_data caddy_data; do
  docker run --rm -v mind-codespaces_$v:/data -v $HOME:/backup busybox \
    tar czf /backup/mind-codespaces-$v-$(date +%F).tgz -C /data .
done'

# Pull them down (or set up scheduled offsite — see PRODUCTION-READINESS §3.7).
rsync -avz mind-codespaces:'~/mind-codespaces-*.tgz' ~/Backups/mind-codespaces/
```

`css_data` is the most important — it's all the user pods. Lose `bridge_registry` and you lose repo metadata + push tokens but the bare repos in `bridge_git_data` are recoverable.

### Update Hetzner password / regenerate it

The deploy used Hetzner's emailed temp root password to bootstrap, then immediately rotated it. The rotated password lives in `~/.mind-codespaces-root-pw.tmp` on your laptop **temporarily** — copy it to your password manager and delete the file:

```bash
cat ~/.mind-codespaces-root-pw.tmp     # copy to 1Password / Bitwarden / Keychain
shred -u ~/.mind-codespaces-root-pw.tmp
```

If you want a fresh password that has never touched this chat, use the Hetzner cloud panel: Server → Actions → "Reset root password". This emails a new temp password and forces another change-on-login cycle, but you'd need console access (not SSH — root SSH is disabled) to use it.

---

## Gotchas hit during first deploy

These are the bugs we fixed while bringing the alpha up; they're now baked into the repo, but knowing about them helps if anything regresses:

1. **rsync's `--exclude='.env*'` matches `.env.example`** — translates 1:1 from `.gitignore` but breaks bootstrap. Use specific excludes (`--exclude='.env' --exclude='.env.local' …`).
2. **`next build` runs `getEnv()` during prerender of `/_not-found`** — production env validation fired with empty env. Fixed in `src/lib/env.ts` by skipping validation when `NEXT_PHASE === "phase-production-build"`.
3. **`POD_USER_PASSWORD` defaulted to the dev-fallback string** even when unset, so prod env validation always failed when an operator (correctly) left it blank for OIDC-delegation-only deploys. Fixed by gating the password check on `ALLOW_SEEDED_FALLBACK=1` (same as the email check).
4. **Named docker volumes inherit root ownership from an empty volume init**, not from the image. Fixed by `RUN mkdir -p /var/lib/mind/registry /var/lib/mind/git-data/repos /var/lib/mind/coder-work && chown -R node:node /var/lib/mind` in the Dockerfile *before* `USER node` — docker then copies the image's metadata onto the volume on first mount.
5. **`tecnativa/docker-socket-proxy` regenerates `haproxy.cfg` from a template at every boot**, so `read_only: true` on the rootfs blocks it. We removed the read-only mode; container is still locked down via `cap_drop: ALL` + the filtered Docker-API surface.
6. **Dockerfile copied `/app/public` which doesn't exist** in this prototype. Fixed by adding `RUN mkdir -p public` to the builder stage.

---

## What is NOT done yet

These are tracked in `PRODUCTION-READINESS.md` and remain open even though the alpha is live:

- **No GitHub repo + no CI** — the `deploy.yml` workflow exists but isn't wired up. Code is rsync'd manually from the laptop. To switch on CI: push this repo to GitHub, add `DEPLOY_HOST` / `DEPLOY_USER` / `DEPLOY_SSH_KEY` secrets, tag `v0.x.y`. The bootstrap script's snapshot path remains as a recovery option.
- **Image digests not pinned** — `caddy:2-alpine`, `solidproject/community-server:7`, etc. are floating tags. Run `infra/prod/scripts/pin-image-digests.sh` after the next image bump.
- **Offsite backups not scheduled** — manual `tar` via the snippet above is the only path. Consider rclone → S3/Backblaze in cron.
- **Workflow runner image (`node:22-alpine`) pulled lazily** — pre-pulled during bootstrap, but if you redeploy from scratch on a different host, pre-pull again.
- **Signup is gated off** by default (`BRIDGE_ENABLE_SIGNUP=` in `.env`). Flip to `1` when you want public account creation.

---

## Recovery scenarios

**Bridge stuck on a bad deploy:** roll back by re-rsync'ing an older code state from your laptop (you have a working copy locally) and rebuilding. With CI: deploy an earlier tag.

**SSH lockout:** Hetzner cloud panel → Console → log in with the rotated root password (from your password manager / `~/.mind-codespaces-root-pw.tmp`). From there, you can edit `/etc/ssh/sshd_config.d/99-mind-codespaces-hardening.conf` to temporarily re-enable password auth, fix the underlying issue, then re-disable.

**Lost rotated root password:** Hetzner cloud panel → Server → Actions → "Reset root password". Emails a new temp password; use console to log in and change.

**DuckDNS subdomain expires (60 days of inactivity):** DuckDNS pings every record automatically, but if it ever expires, your subdomains are gone. Migration target is a real `.com` domain; WebIDs will need user-side reconnection because they're origin-bound.

**Domain change:** see `PRODUCTION-READINESS.md` § identity migration — WebIDs are sticky and changing the pod host orphans every user's signed-up identity.
