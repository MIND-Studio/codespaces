import "server-only";
import { getDb } from "@/lib/registry/db";

/**
 * Per-owner quotas (§4 multi-user).
 *
 * The bridge is single-tenant in dev but multi-user in prod, where one
 * abusive owner could otherwise:
 *   • create unlimited repos → fill disk
 *   • mint unlimited push tokens → broaden the attack surface of a leak
 *   • dispatch unlimited workflow runs → burn OpenRouter budget +
 *     accumulate stuck containers
 *   • push unlimited bytes per repo → fill disk via a few enormous repos
 *
 * Quotas are enforced as defaults driven by env, not per-row overrides
 * — keeping the SQL story simple. A future "premium tier" lands as a
 * per-owner row in a quotas table.
 *
 * Env defaults (overridable via the named variable):
 *   MAX_REPOS_PER_OWNER         50
 *   MAX_TOKENS_PER_REPO         10
 *   MAX_RUNS_PER_OWNER_PER_DAY  500
 *   MAX_DISK_PER_REPO_BYTES     1073741824    (1 GiB)
 *
 * The "runs per day" window is a rolling 24h, computed against
 * workflow_runs.created_at + agent_runs.started_at. Cheap query: one
 * COUNT per check.
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : fallback;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const QUOTAS = {
  maxReposPerOwner: envInt("MAX_REPOS_PER_OWNER", 50),
  maxTokensPerRepo: envInt("MAX_TOKENS_PER_REPO", 10),
  maxRunsPerOwnerPerDay: envInt("MAX_RUNS_PER_OWNER_PER_DAY", 500),
  maxDiskPerRepoBytes: envInt(
    "MAX_DISK_PER_REPO_BYTES",
    1024 * 1024 * 1024,
  ),
  // Mind Packages (docs/PACKAGES-PLAN.md). Package blobs live in the pod, so
  // these guard the bridge's own ingest path, not local disk:
  //   • a single artifact larger than this is refused outright (default
  //     100 MiB — the in-memory ingest can't stream yet, so this is also an
  //     OOM guard; raise it once OCI streaming lands)
  //   • the sum of a repo's published blob sizes is capped separately from
  //     git disk so a few large images can't fill the pod (default 2 GiB)
  maxPackageBlobBytes: envInt("MAX_PACKAGE_BLOB_BYTES", 100 * 1024 * 1024),
  maxPackageBytesPerRepo: envInt(
    "MAX_PACKAGE_BYTES_PER_REPO",
    2 * 1024 * 1024 * 1024,
  ),
};

export class QuotaExceededError extends Error {
  constructor(
    public readonly quota: keyof typeof QUOTAS,
    public readonly limit: number,
    public readonly observed: number,
  ) {
    super(
      `quota exceeded: ${quota} (observed ${observed} >= limit ${limit})`,
    );
  }
}

export function countReposForOwner(owner: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM repos WHERE owner = ?")
    .get(owner) as { c: number };
  return row.c;
}

export function assertCanCreateRepo(owner: string): void {
  const observed = countReposForOwner(owner);
  if (observed >= QUOTAS.maxReposPerOwner) {
    throw new QuotaExceededError(
      "maxReposPerOwner",
      QUOTAS.maxReposPerOwner,
      observed,
    );
  }
}

export function countTokensForRepo(repoId: number): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM push_tokens WHERE repo_id = ?")
    .get(repoId) as { c: number };
  return row.c;
}

export function assertCanMintToken(repoId: number): void {
  const observed = countTokensForRepo(repoId);
  if (observed >= QUOTAS.maxTokensPerRepo) {
    throw new QuotaExceededError(
      "maxTokensPerRepo",
      QUOTAS.maxTokensPerRepo,
      observed,
    );
  }
}

/**
 * Count workflow + agent runs initiated by this owner in the last 24h.
 * Joins through repos.owner so we charge the bill to the WebID that
 * actually owns the runs, not the IP that triggered them.
 */
export function countRunsForOwnerPast24h(owner: string): number {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const workflow = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM workflow_runs r
         JOIN repos ON repos.id = r.repo_id
        WHERE repos.owner = ? AND r.started_at >= ?`,
    )
    .get(owner, since) as { c: number };
  const agent = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM agent_runs r
         JOIN repos ON repos.id = r.repo_id
        WHERE repos.owner = ? AND r.created_at >= ?`,
    )
    .get(owner, since) as { c: number };
  return workflow.c + agent.c;
}

export function assertCanDispatchRun(owner: string): void {
  const observed = countRunsForOwnerPast24h(owner);
  if (observed >= QUOTAS.maxRunsPerOwnerPerDay) {
    throw new QuotaExceededError(
      "maxRunsPerOwnerPerDay",
      QUOTAS.maxRunsPerOwnerPerDay,
      observed,
    );
  }
}

/** Sum of all published package blob sizes for a repo. */
export function sumPackageBytesForRepo(repoId: number): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(size_bytes), 0) AS c FROM packages WHERE repo_id = ?")
    .get(repoId) as { c: number };
  return row.c;
}

/**
 * Guard a package upload of `addBytes`: refuse an oversized single blob, and
 * refuse if it would push the repo's total package storage over the cap.
 * (Re-publishing an existing version slightly over-counts here — a known v0
 * simplification, since the CAS dedups but the index sum doesn't subtract the
 * replaced row.)
 */
export function assertCanStorePackage(repoId: number, addBytes: number): void {
  if (addBytes > QUOTAS.maxPackageBlobBytes) {
    throw new QuotaExceededError(
      "maxPackageBlobBytes",
      QUOTAS.maxPackageBlobBytes,
      addBytes,
    );
  }
  const observed = sumPackageBytesForRepo(repoId);
  if (observed + addBytes > QUOTAS.maxPackageBytesPerRepo) {
    throw new QuotaExceededError(
      "maxPackageBytesPerRepo",
      QUOTAS.maxPackageBytesPerRepo,
      observed + addBytes,
    );
  }
}
