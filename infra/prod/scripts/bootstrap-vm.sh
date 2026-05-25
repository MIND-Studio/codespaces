#!/usr/bin/env bash
# Bring a fresh Ubuntu/Debian VM up to a running mind-codespaces stack.
#
# Idempotent: safe to re-run. Each step checks state and skips work
# that has already happened. Stops with a clear message when human
# action is required (secrets to fill in, log out for docker group, etc).
#
# Usage on a fresh VM:
#   curl -fsSL https://raw.githubusercontent.com/<you>/mind-codespaces/main/infra/prod/scripts/bootstrap-vm.sh -o bootstrap.sh
#   chmod +x bootstrap.sh
#   REPO_URL=https://github.com/<you>/mind-codespaces.git ./bootstrap.sh
#
# Or if you've already SCP'd the script up:
#   REPO_URL=... ./bootstrap-vm.sh
#
# Environment overrides:
#   REPO_URL    — Required. Git URL to clone (https or git@).
#   REPO_REF    — Optional. Branch/tag to check out. Default: main.
#   DEPLOY_DIR  — Optional. Where to clone. Default: /opt/mind-codespaces.

set -euo pipefail

# Two ways to seed the deploy directory:
#   • REPO_URL set  → git-clone into $DEPLOY_DIR (the CI-friendly path)
#   • REPO_URL unset → assume $DEPLOY_DIR is already populated (e.g. via
#     rsync from a developer laptop). Updates require re-rsyncing.
REPO_URL="${REPO_URL:-}"
REPO_REF="${REPO_REF:-main}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/mind-codespaces}"

log() { printf '\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[bootstrap]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[bootstrap]\033[0m %s\n' "$*" >&2; exit 1; }

# --------------------------------------------------------------------
# 1. Sanity checks
# --------------------------------------------------------------------
[ "$(id -u)" -ne 0 ] || die "Run as a normal user with sudo, not as root. The user needs to end up in the 'docker' group."
command -v sudo >/dev/null || die "sudo not installed."
command -v curl >/dev/null || die "curl not installed (apt-get install -y curl)."
if [ -n "$REPO_URL" ]; then
  command -v git >/dev/null || die "git not installed (apt-get install -y git) — needed because REPO_URL is set."
fi

# --------------------------------------------------------------------
# 2. Docker Engine + Compose v2
# --------------------------------------------------------------------
if ! command -v docker >/dev/null; then
  log "Installing Docker Engine via get.docker.com…"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  warn "Added '$USER' to the docker group."
  warn "You must log out and back in (or run 'newgrp docker') so the new group takes effect."
  warn "Then re-run this script."
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  die "Docker is installed but the daemon is not reachable. Either it isn't running (sudo systemctl start docker) or your user isn't in the docker group yet (re-login after the usermod above)."
fi

if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose v2 plugin is missing. get.docker.com bundles it; if you installed Docker some other way, run 'sudo apt-get install -y docker-compose-plugin'."
fi

log "Docker $(docker --version | awk '{print $3}' | tr -d ,) / Compose $(docker compose version --short) ✔"

# --------------------------------------------------------------------
# 3. Clone or update the deploy checkout
# --------------------------------------------------------------------
if [ -n "$REPO_URL" ]; then
  # CI-friendly path: git-managed.
  if [ ! -d "$DEPLOY_DIR/.git" ]; then
    log "Cloning $REPO_URL → $DEPLOY_DIR (ref: $REPO_REF)"
    sudo mkdir -p "$DEPLOY_DIR"
    sudo chown "$USER:$USER" "$DEPLOY_DIR"
    git clone --branch "$REPO_REF" "$REPO_URL" "$DEPLOY_DIR"
  else
    log "Updating $DEPLOY_DIR"
    git -C "$DEPLOY_DIR" fetch --tags --prune
    git -C "$DEPLOY_DIR" checkout --quiet "$REPO_REF"
    git -C "$DEPLOY_DIR" pull --ff-only
  fi
else
  # Snapshot path: $DEPLOY_DIR was populated by rsync/scp from a laptop.
  # We just verify the layout is right.
  [ -f "$DEPLOY_DIR/infra/prod/docker-compose.yml" ] \
    || die "REPO_URL unset and $DEPLOY_DIR/infra/prod/docker-compose.yml not found. rsync the prototype here first, or set REPO_URL=https://github.com/<you>/mind-codespaces.git."
  log "Using existing snapshot at $DEPLOY_DIR (no git, no auto-update)."
fi

# --------------------------------------------------------------------
# 4. Host directories the bridge expects
# --------------------------------------------------------------------
# uid 1000 = the `node` user inside the bridge image. The coder-work
# dir is a host bind mount (must resolve to the same path on host and
# inside the container — see coder driver's MIND_CODER_WORKROOT doc).
if [ ! -d /var/lib/mind/coder-work ]; then
  log "Creating /var/lib/mind/coder-work (uid 1000 owner)"
  sudo mkdir -p /var/lib/mind/coder-work
  sudo chown 1000:1000 /var/lib/mind/coder-work
fi

# --------------------------------------------------------------------
# 5. .env scaffolding
# --------------------------------------------------------------------
ENV_FILE="$DEPLOY_DIR/infra/prod/.env"
if [ ! -f "$ENV_FILE" ]; then
  log "Creating $ENV_FILE from .env.example"
  cp "$DEPLOY_DIR/infra/prod/.env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  log "Generating secrets and writing them into $ENV_FILE…"
  SESS=$(openssl rand -hex 32)
  IDENT=$(openssl rand -hex 32)
  HOOK=$(openssl rand -hex 24)
  ADMIN=$(openssl rand -hex 32)
  METRICS=$(openssl rand -hex 32)

  # Use a temp file + mv so a SIGINT mid-edit can't corrupt the .env.
  tmp=$(mktemp)
  awk -v sess="$SESS" -v ident="$IDENT" -v hook="$HOOK" -v admin="$ADMIN" -v metrics="$METRICS" '
    /^BRIDGE_SESSION_SECRET=$/    { print "BRIDGE_SESSION_SECRET="sess; next }
    /^BRIDGE_HOOK_SECRET=$/       { print "BRIDGE_HOOK_SECRET="hook; next }
    /^IDENTITY_ENCRYPTION_KEY=$/  { print "IDENTITY_ENCRYPTION_KEY="ident; next }
    /^BRIDGE_ADMIN_TOKEN=$/       { print "BRIDGE_ADMIN_TOKEN="admin; next }
    /^BRIDGE_METRICS_TOKEN=$/     { print "BRIDGE_METRICS_TOKEN="metrics; next }
    { print }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  cat <<EOF

  Secrets generated. Now edit $ENV_FILE and set:

    MIND_DOMAIN_BRIDGE   — e.g. codespaces.example.com (must already point at this VM)
    MIND_DOMAIN_POD      — e.g. pod.example.com        (must already point at this VM)
    ACME_EMAIL           — for Let's Encrypt expiry warnings
    OPENROUTER_API_KEY   — leave blank to ship without agents
    BRIDGE_ENABLE_SIGNUP — set to 1 if you want public account creation

  When you're done, re-run this script.

EOF
  exit 0
fi

# Refuse to proceed if any required secret is still empty — running
# the stack without these would fail-closed inside the bridge anyway,
# better to catch it here with a readable message.
for v in MIND_DOMAIN_BRIDGE MIND_DOMAIN_POD ACME_EMAIL BRIDGE_SESSION_SECRET BRIDGE_HOOK_SECRET IDENTITY_ENCRYPTION_KEY; do
  val=$(grep -E "^${v}=" "$ENV_FILE" | head -1 | cut -d= -f2-)
  if [ -z "$val" ] || [ "$val" = "you@example.com" ] || [ "$val" = "codespaces.example.com" ] || [ "$val" = "pod.example.com" ]; then
    die "$ENV_FILE has $v still unset or at its placeholder. Fill it in and re-run."
  fi
done

# --------------------------------------------------------------------
# 6. Coder sandbox image (built locally, not pulled)
# --------------------------------------------------------------------
if ! docker image inspect mind-codespaces/coder:latest >/dev/null 2>&1; then
  log "Building mind-codespaces/coder:latest"
  docker build -t mind-codespaces/coder:latest "$DEPLOY_DIR/infra/coder"
else
  log "mind-codespaces/coder:latest already built ✔"
fi

# --------------------------------------------------------------------
# 7. Pre-pull the workflow runner base image
# --------------------------------------------------------------------
if ! docker image inspect node:22-alpine >/dev/null 2>&1; then
  log "Pulling node:22-alpine (workflow runner base, ~150 MB)"
  docker pull node:22-alpine
fi

# --------------------------------------------------------------------
# 8. Start (or refresh) the stack
# --------------------------------------------------------------------
cd "$DEPLOY_DIR/infra/prod"
# First boot builds the bridge image on this VM (slow, ~5min).
# Subsequent boots will skip the build if the layer cache is intact.
# After CI is wired up, deploys use docker-compose.prod.yml instead
# (registry-pulled, no on-VM build). See .github/workflows/deploy.yml.
log "Starting the stack (building bridge image on first run)…"
docker compose --env-file .env up -d --build

log "Done. Watching status — press Ctrl-C to exit."
docker compose --env-file .env ps
cat <<EOF

  Next steps:
    • Tail logs:        docker compose --env-file .env logs -f bridge
    • Open dashboard:   https://\$MIND_DOMAIN_BRIDGE/repos
    • Verify TLS:       curl -fsSL https://\$MIND_DOMAIN_BRIDGE/api/health
    • Pin image digests after every image bump:
        cd $DEPLOY_DIR/infra/prod && ./scripts/pin-image-digests.sh

EOF
