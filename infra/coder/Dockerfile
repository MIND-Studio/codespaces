# Coder image: opencode + git + a browser stack inside Microsoft's
# official Playwright base. The bridge spawns one of these per coder
# agent run with the issue's checkout bind-mounted at /work.
#
# Why the playwright base? We tried alpine + apk chromium first; that
# burned a day on missing fonts, sandbox quirks, and the browser-
# install dance every time opencode invoked playwright-mcp. The
# Microsoft image ships chromium + firefox + webkit at known paths
# under /ms-playwright with all native deps (libnss, libxss, fonts,
# video codecs, …) baked in, so the whole class of bug goes away.
#
# Container hardening is enforced by the BRIDGE at run time, not by
# this image:
#   --read-only --tmpfs /tmp --cap-drop ALL --no-new-privileges
#   --pids-limit --ulimit nofile --user $(host-uid):$(host-gid)
# See src/lib/agents/drivers/coder.ts for the full dockerArgs.

FROM mcr.microsoft.com/playwright:v1.55.0-noble

# git, openssh-client: cloning + (future) ssh remotes.
# ripgrep: opencode's file-search tool spawns rg; without one on PATH
# opencode tries to extract a bundled rg into ~/.cache, which fails
# intermittently in the sandbox.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git openssh-client ripgrep \
 && rm -rf /var/lib/apt/lists/*

# opencode + the Playwright MCP server. We install both globally so the
# binaries land on PATH at /usr/local/bin/{opencode,playwright-mcp}.
# Then we tell playwright (the one bundled inside @playwright/mcp) to
# materialise its exact pinned chromium + firefox builds into the
# base image's /ms-playwright dir. The base image's preinstalled
# browsers stay there as a fallback; playwright-mcp's bundled playwright
# picks whichever version it pinned.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install -g --no-fund --no-audit \
      opencode-ai@^1.15 \
      @playwright/mcp@latest \
 && node /usr/lib/node_modules/@playwright/mcp/node_modules/playwright/cli.js install \
      chromium firefox \
 && chmod -R a+rX /ms-playwright \
 && rm -rf /tmp/opencode

# opencode looks for state under $XDG_DATA_HOME/opencode and config
# under $XDG_CONFIG_HOME/opencode. The entrypoint materialises both
# under /tmp at run time because the bridge passes --user $(host-uid),
# which has no home dir inside the container; /tmp is writable by any
# uid because the bridge also mounts it as a tmpfs.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /work
ENTRYPOINT ["/entrypoint.sh"]
