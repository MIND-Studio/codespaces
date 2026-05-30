#!/bin/sh
# Entry for the codex sandbox image. The bridge invokes us with the codex
# subcommand + args, e.g.:
#   codex exec --dangerously-bypass-approvals-and-sandbox -C /work <task>
# We just set up a writable home + auth, then exec codex with those args.
set -eu

# The bridge runs us --read-only with a tmpfs /tmp and --user <host-uid>,
# so there's no usable home dir. Point codex's state + auth at the tmpfs.
export CODEX_HOME="${CODEX_HOME:-/tmp/.codex}"
export HOME="${HOME:-/tmp}"
mkdir -p "$CODEX_HOME"

# Materialise API-key auth from OPENAI_API_KEY (forwarded by the bridge as
# an env *name* only — Docker reads the value from the bridge process env at
# exec time, so it never appears in `ps`/argv). `codex login --with-api-key`
# reads the key from stdin and writes $CODEX_HOME/auth.json.
#
# Host-runtime runs use the operator's own `~/.codex` ChatGPT login and
# never reach this image, so OPENAI_API_KEY is only expected here.
if [ -n "${OPENAI_API_KEY:-}" ]; then
  printf '%s' "$OPENAI_API_KEY" | codex login --with-api-key >/dev/null 2>&1 \
    || echo "[codex-entrypoint] warning: 'codex login --with-api-key' failed" >&2
else
  echo "[codex-entrypoint] warning: OPENAI_API_KEY not set — codex will be unauthenticated" >&2
fi

exec codex "$@"
