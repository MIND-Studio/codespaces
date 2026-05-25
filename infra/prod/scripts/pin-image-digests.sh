#!/usr/bin/env bash
#
# Pin every floating image tag in docker-compose.yml to a sha256 digest.
# Run on the production host AFTER `docker compose pull`, so the digests
# reflect what the daemon actually verified against the registry. The
# script edits docker-compose.yml in place (a `.bak` is kept beside it).
#
# Why this is a separate step rather than committed digests: a digest
# is a verifiable supply-chain artefact, and putting one in source
# control means we're claiming we verified it — which we can only do
# from the deploy host with a working Docker daemon and registry pull.
#
# Targets the canonical floating tags used in docker-compose.yml:
#   - caddy:2-alpine
#   - solidproject/community-server:7
#   - tecnativa/docker-socket-proxy:0.3.0
#
# The bridge image is built locally and intentionally not pinned here
# (its identity comes from the Dockerfile + build context, not a
# registry digest).
#
# Usage:
#   cd infra/prod
#   docker compose pull
#   ./scripts/pin-image-digests.sh

set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f docker-compose.yml ]; then
  echo "ERROR: docker-compose.yml not found in $(pwd)"
  exit 1
fi

# (tag-as-it-appears-in-compose, registry-name) tuples — keep aligned.
declare -a TARGETS=(
  "caddy:2-alpine|caddy:2-alpine"
  "solidproject/community-server:7|solidproject/community-server:7"
  "tecnativa/docker-socket-proxy:0.3.0|tecnativa/docker-socket-proxy:0.3.0"
)

cp docker-compose.yml docker-compose.yml.bak
echo "backed up docker-compose.yml → docker-compose.yml.bak"

for entry in "${TARGETS[@]}"; do
  tag="${entry%%|*}"
  ref="${entry##*|}"
  echo "resolving ${ref}…"
  digest=$(docker inspect --format='{{index .RepoDigests 0}}' "${ref}" 2>/dev/null || true)
  if [ -z "${digest}" ]; then
    echo "  WARN: ${ref} not present locally; skipping (run 'docker compose pull' first?)"
    continue
  fi
  # `docker inspect` prints `<repo>@sha256:<hex>` — strip the repo prefix
  # so we can substitute just the digest into the existing tag line.
  short_digest="${digest#*@}"
  if [ -z "${short_digest}" ] || [ "${short_digest}" = "${digest}" ]; then
    echo "  WARN: could not parse digest from '${digest}'"
    continue
  fi
  echo "  ${tag} → ${short_digest}"
  # Replace `${tag}  # TODO: pin @sha256:` (any trailing comment) with
  # `${tag}@${short_digest}` and a marker comment so a second run is
  # idempotent.
  python3 - "$tag" "$short_digest" docker-compose.yml <<'PY'
import re, sys
tag, digest, path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    src = f.read()
escaped = re.escape(tag)
pattern = re.compile(
    r"image:\s*" + escaped + r"(@sha256:[0-9a-f]+)?(\s*#[^\n]*)?",
)
def sub(m):
    return f"image: {tag}@{digest}  # pinned by pin-image-digests.sh"
src = pattern.sub(sub, src)
with open(path, "w") as f:
    f.write(src)
PY
done

echo ""
echo "done. Review the diff:"
echo "  diff -u docker-compose.yml.bak docker-compose.yml"
echo ""
echo "Then bring the stack up:"
echo "  docker compose up -d"
