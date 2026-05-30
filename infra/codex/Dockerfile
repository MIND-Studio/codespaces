# Codex image: OpenAI `codex` CLI + git inside a slim Node base. The
# bridge's `codex` driver spawns one of these per agent run (docker
# runtime) with the issue's checkout bind-mounted at /work.
#
# Unlike the coder (opencode) image there is no browser stack: the codex
# PoC driver doesn't take screenshots, so we skip the heavy Playwright
# base and ship a much smaller image.
#
# Container hardening is enforced by the BRIDGE at run time, not by this
# image:
#   --read-only --tmpfs /tmp --cap-drop ALL --no-new-privileges
#   --pids-limit --ulimit nofile --user $(host-uid):$(host-gid)
# and codex itself runs with --dangerously-bypass-approvals-and-sandbox
# because the container IS the sandbox. See src/lib/agents/drivers/codex.ts.

FROM node:22-bookworm-slim

# git: cloning + commit identity. ripgrep: codex's shell tool reaches for
# `rg` for fast file search. ca-certificates: HTTPS to the OpenAI API.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git ca-certificates ripgrep \
 && rm -rf /var/lib/apt/lists/*

# Pin to the version verified against the driver (codex-cli 0.135.0).
RUN npm install -g --no-fund --no-audit @openai/codex@0.135.0

# Codex stores auth (auth.json) + session state under $CODEX_HOME. The
# bridge runs this image read-only as --user $(host-uid) (no home dir
# inside the container), so the entrypoint points CODEX_HOME + HOME at the
# writable /tmp tmpfs and materialises auth.json there from OPENAI_API_KEY.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /work
ENTRYPOINT ["/entrypoint.sh"]
