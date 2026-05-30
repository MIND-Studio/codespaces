#!/bin/sh
# Materialise opencode's per-run state from env at startup. The bridge
# selects ONE provider per run and forwards exactly that provider's API
# key under every env alias opencode/the AI SDK might look for. We
# template `auth.json` from whichever env vars are set, so adding a new
# provider just means appending a block here.
set -e

# opencode resolves state under $XDG_DATA_HOME/opencode and config under
# $XDG_CONFIG_HOME/opencode (falling back to ~/.local/share/opencode and
# ~/.config/opencode). We pin both at /tmp because that's writable by
# every uid we might run as (the bridge passes --user $(host-uid)).
export XDG_DATA_HOME=/tmp
export XDG_CONFIG_HOME=/tmp/config
export HOME=/tmp
mkdir -p /tmp/opencode /tmp/config/opencode

# The bridge logs MIND_AI_PROVIDER for forensics. The auth file itself
# is provider-driven: we emit a block for whichever key env var is
# present, and opencode picks the right one based on the -m flag.
AUTH=/tmp/opencode/auth.json
echo "{" > "$AUTH"
sep=""

add_provider() {
  # $1 = provider name (matches the opencode auth key)
  # $2 = the env var holding the key
  eval "value=\${$2:-}"
  if [ -n "$value" ]; then
    printf '%s  "%s": {"type": "api", "key": "%s"}\n' "$sep" "$1" "$value" >> "$AUTH"
    sep=","
  fi
}

add_provider openrouter OPENROUTER_API_KEY
# Google's AI SDK has historically picked between two env names —
# whichever the bridge forwarded, we'll see one of them.
if [ -n "${GEMINI_API_KEY:-}${GOOGLE_GENERATIVE_AI_API_KEY:-}" ]; then
  key="${GEMINI_API_KEY:-$GOOGLE_GENERATIVE_AI_API_KEY}"
  printf '%s  "google": {"type": "api", "key": "%s"}\n' "$sep" "$key" >> "$AUTH"
  sep=","
fi
add_provider anthropic ANTHROPIC_API_KEY
add_provider openai OPENAI_API_KEY

echo "}" >> "$AUTH"
chmod 600 "$AUTH"

if [ "$sep" = "" ]; then
  echo "[coder/entrypoint] no provider key found in env (checked OPENROUTER_API_KEY, GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY); opencode will fail to auth" >&2
fi

# Register @playwright/mcp as an MCP tool source so the coder can drive
# a browser (navigate file:// URLs, click, screenshot) as part of its
# task. We invoke the binary directly rather than via `npx` because the
# bridge runs the container --read-only with a small /tmp tmpfs, and
# `npx` would waste it on its own npm cache.
#
#   --browser chromium  pin the browser so it never silently downloads
#                       firefox at run time (opencode's "verify with the
#                       browser" prompt previously triggered a 95 MiB
#                       firefox fetch into the tmpfs).
#   --headless          there is no display in the container.
#   --isolated          don't persist cookies/localStorage between calls.
#   --no-sandbox        the bridge runs the container with --cap-drop
#                       ALL, which removes CAP_SYS_ADMIN — chromium's
#                       user-namespace sandbox can't initialise without
#                       it. The container itself is the sandbox.
#   --allow-unrestricted-file-access
#                       playwright-mcp blocks file:// URLs by default,
#                       which makes "navigate to file:///work/index.html
#                       and screenshot" silently fail with no actionable
#                       error for the model. We override because the
#                       container is the sandbox (--read-only, --cap-drop
#                       ALL, only /work writable) — file:// access can
#                       only ever reach /work plus the image's read-only
#                       fs, both already trusted.
cat > /tmp/config/opencode/config.json <<'EOF'
{
  "mcp": {
    "playwright": {
      "type": "local",
      "enabled": true,
      "command": [
        "/usr/bin/playwright-mcp",
        "--browser", "chromium",
        "--headless",
        "--isolated",
        "--no-sandbox",
        "--allow-unrestricted-file-access"
      ]
    }
  }
}
EOF

# Forward all CLI args to opencode. Default subcommand is `run` so the
# bridge can pass just the model + task and skip repeating "run".
exec opencode "$@"
