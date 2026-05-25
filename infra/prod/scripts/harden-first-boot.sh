#!/usr/bin/env bash
# One-shot first-boot hardening for a fresh Hetzner / DigitalOcean / etc.
# Ubuntu or Debian VM. Run as root, immediately after `ssh-copy-id` and
# `passwd` (those two are interactive and must be done by hand first).
#
# What this does, in order:
#   1. Creates a non-root `deploy` user with passwordless sudo and the
#      same authorized_keys as root.
#   2. Disables password SSH and root SSH login.
#   3. Installs and configures ufw to allow only 22 / 80 / 443.
#
# Idempotent — re-running is safe.
#
# Recovery if you lock yourself out:
#   • From a SECOND terminal (don't close the working root session yet)
#     try `ssh deploy@<ip>`. If it works, the lockdown is fine.
#   • If it fails, fix sshd_config from the still-open root session and
#     re-run `systemctl reload ssh`.
#   • Hetzner's web console (Cloud → Server → Console) is the last-resort
#     out-of-band login.

set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }

DEPLOY_USER="${DEPLOY_USER:-deploy}"

log() { printf '\033[1;34m[harden]\033[0m %s\n' "$*"; }

# --------------------------------------------------------------------
# 1. Deploy user
# --------------------------------------------------------------------
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  log "user '$DEPLOY_USER' already exists"
else
  log "creating user '$DEPLOY_USER' (no password — SSH key only)"
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
fi

usermod -aG sudo "$DEPLOY_USER"

# Passwordless sudo for the deploy user. Justification: this user only
# ever logs in over SSH key, and bootstrap-vm.sh needs apt-get without
# tty interaction. The SSH key IS the authentication factor; a sudo
# password gate on the same identity adds no real security (an attacker
# with the key can read .env, the SQLite DB, and the bare repos anyway).
SUDOERS_FILE="/etc/sudoers.d/90-${DEPLOY_USER}-nopasswd"
if [ ! -f "$SUDOERS_FILE" ]; then
  log "granting passwordless sudo to '$DEPLOY_USER'"
  echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "$SUDOERS_FILE"
  chmod 440 "$SUDOERS_FILE"
  # Validate before reload (corrupt sudoers can lock you out of sudo).
  visudo -cf "$SUDOERS_FILE" >/dev/null
fi

# Copy root's authorized_keys to the deploy user so the SSH key you
# just installed for root also works for deploy.
USER_HOME=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
mkdir -p "$USER_HOME/.ssh"
if [ -f /root/.ssh/authorized_keys ]; then
  cp /root/.ssh/authorized_keys "$USER_HOME/.ssh/authorized_keys"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$USER_HOME/.ssh"
chmod 700 "$USER_HOME/.ssh"
chmod 600 "$USER_HOME/.ssh/authorized_keys"

# --------------------------------------------------------------------
# 2. SSH lockdown
# --------------------------------------------------------------------
SSHD=/etc/ssh/sshd_config
log "tightening $SSHD"

# Use a drop-in instead of editing the main file in place — survives
# distro upgrades that replace sshd_config.
DROPIN=/etc/ssh/sshd_config.d/99-mind-codespaces-hardening.conf
cat > "$DROPIN" <<'EOF'
# mind-codespaces first-boot hardening — see infra/prod/scripts/harden-first-boot.sh
PasswordAuthentication no
PermitRootLogin no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
EOF
chmod 644 "$DROPIN"

# Some Ubuntu builds shipped Include directives only after 22.04;
# older configs need a guard. We append an explicit Include if missing.
if ! grep -qE '^\s*Include\s+/etc/ssh/sshd_config\.d/' "$SSHD"; then
  log "adding Include /etc/ssh/sshd_config.d/ to $SSHD"
  echo "Include /etc/ssh/sshd_config.d/*.conf" >> "$SSHD"
fi

sshd -t   # validate config before reload — refuses on parse error
systemctl reload ssh

# --------------------------------------------------------------------
# 3. Firewall — only 22 / 80 / 443
# --------------------------------------------------------------------
if ! command -v ufw >/dev/null; then
  log "installing ufw"
  DEBIAN_FRONTEND=noninteractive apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y ufw
fi

ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null      # SSH
ufw allow 80/tcp >/dev/null      # HTTP (Caddy ACME challenge + redirect)
ufw allow 443/tcp >/dev/null     # HTTPS
ufw allow 443/udp >/dev/null     # HTTP/3 (QUIC)
# Note: Docker bypasses ufw for container-published ports. The compose
# stack only publishes 80/443 on the host anyway, and ufw above already
# permits those; no DOCKER-USER chain hacks needed for this deployment.
ufw --force enable
ufw status numbered

# --------------------------------------------------------------------
# 4. Optional but cheap: automatic security updates
# --------------------------------------------------------------------
if ! dpkg -s unattended-upgrades >/dev/null 2>&1; then
  log "installing unattended-upgrades (security-only by default)"
  DEBIAN_FRONTEND=noninteractive apt-get install -y unattended-upgrades
fi

cat <<EOF

Hardening done. Test from a SECOND local terminal before you exit this
root session:

    ssh -i ~/.ssh/id_ed25519_mind_codespaces ${DEPLOY_USER}@\$(curl -s ifconfig.me)

If that works, you can exit root and switch to '${DEPLOY_USER}' for
everything from here on.

EOF
