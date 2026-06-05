# syntax=docker/dockerfile:1.7
#
# Production image for the mind-codespaces collab relay — an EPHEMERAL
# y-websocket room broker (see relay/server.ts and relay/README.md).
# Optional: prod can instead point NEXT_PUBLIC_COLLAB_RELAY_URL at the shared
# whiteboard relay (the room namespace keeps the two apps' docs separate).
#
# Deliberately minimal and isolated:
#   • NO pod credentials, NO @mind-studio scope, NO .npmrc, NO GHCR secret —
#     every dep is public npm, so this builds with zero auth.
#   • NO persistence. The relay holds in-memory Yjs docs only; kill it and the
#     pod copies are untouched. So this image mounts no volumes (compose).
#   • Runs the TypeScript entrypoint via tsx (a devDep), matching `npm run relay`.
#
# Build context is this relay/ directory (the workflow sets context: ./relay),
# so the relay's own package.json/server.ts are at the context root.

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

# Install relay deps (includes tsx). No lockfile in relay/, so `npm install`.
COPY package.json ./
RUN npm install --no-audit --no-fund

COPY server.ts ./
RUN chown -R node:node /app

USER node

# server.ts reads RELAY_PORT / RELAY_HOST; default 3012 (dev) / 0.0.0.0.
ENV NODE_ENV=production \
    RELAY_PORT=3012 \
    RELAY_HOST=0.0.0.0

EXPOSE 3012

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "tsx", "server.ts"]
