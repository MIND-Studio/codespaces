import "server-only";
import { getDb } from "@/lib/registry/db";

export type Visibility = "public" | "private";

export type Repo = {
  id: number;
  owner: string;
  name: string;
  ownerWebId: string;
  ownerPodRoot: string;
  defaultBranch: string;
  visibility: Visibility;
  createdAt: number;
  /** Whether the public "propose an issue" endpoint is open for this repo. */
  proposalsEnabled: boolean;
  /** Whether draft co-authoring connects to the live relay (off = local-only). */
  collabEnabled: boolean;
};

export type PublishStatus = "success" | "failed" | "needs-reauth";

export type PagesConfig = {
  repoId: number;
  enabled: boolean;
  sourceBranch: string;
  sourcePath: string;
  targetContainer: string;
  lastPublishedAt: number | null;
  lastPublishStatus: PublishStatus | null;
  lastPublishError: string | null;
  lastPublishAttempt: number | null;
  lastPublishedSha: string | null;
};

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export class RegistryError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_NAME"
      | "ALREADY_EXISTS"
      | "NOT_FOUND"
      | "INVALID_INPUT",
  ) {
    super(message);
  }
}

export function validateName(value: string, field: "owner" | "repo"): void {
  if (typeof value !== "string" || !NAME_RE.test(value) || value.includes("..")) {
    throw new RegistryError(
      `Invalid ${field} name: ${JSON.stringify(value)}`,
      "INVALID_NAME",
    );
  }
}

export function createRepo(input: {
  owner: string;
  name: string;
  ownerWebId: string;
  ownerPodRoot: string;
  defaultBranch?: string;
  visibility?: Visibility;
}): Repo {
  validateName(input.owner, "owner");
  validateName(input.name, "repo");

  if (!input.ownerWebId.startsWith("http")) {
    throw new RegistryError("ownerWebId must be an http(s) URL", "INVALID_INPUT");
  }
  if (!input.ownerPodRoot.startsWith("http")) {
    throw new RegistryError("ownerPodRoot must be an http(s) URL", "INVALID_INPUT");
  }

  const db = getDb();
  const now = Date.now();
  const defaultBranch = input.defaultBranch ?? "main";
  const visibility: Visibility = input.visibility ?? "public";

  if (visibility !== "public" && visibility !== "private") {
    throw new RegistryError(
      `visibility must be 'public' or 'private', got ${JSON.stringify(visibility)}`,
      "INVALID_INPUT",
    );
  }

  try {
    // Wrap the two inserts in a transaction so a crash in between leaves
    // no `repos` row without its `pages_configs` partner — that would
    // make every Pages PUT fail with "config not found" afterwards. P0-R6.
    const newId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO repos
            (owner, name, owner_webid, owner_pod_root, default_branch, visibility, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.owner,
          input.name,
          input.ownerWebId,
          input.ownerPodRoot,
          defaultBranch,
          visibility,
          now,
        );
      const id = info.lastInsertRowid as number;
      db.prepare(
        `INSERT INTO pages_configs (repo_id, enabled, source_branch, source_path, target_container)
         VALUES (?, 0, ?, '/', '')`,
      ).run(id, defaultBranch);
      return id;
    })();

    return getRepoById(newId)!;
  } catch (e) {
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      throw new RegistryError(
        `Repo ${input.owner}/${input.name} already exists`,
        "ALREADY_EXISTS",
      );
    }
    throw e;
  }
}

export function deleteRepoById(id: number): void {
  // Used by callers that need to roll back a failed bare-repo creation.
  getDb().prepare("DELETE FROM repos WHERE id = ?").run(id);
}

function rowToRepo(row: Record<string, unknown>): Repo {
  return {
    id: row.id as number,
    owner: row.owner as string,
    name: row.name as string,
    ownerWebId: row.owner_webid as string,
    ownerPodRoot: row.owner_pod_root as string,
    defaultBranch: row.default_branch as string,
    visibility: row.visibility as Visibility,
    createdAt: row.created_at as number,
    proposalsEnabled: (row.proposals_enabled as number) !== 0,
    collabEnabled: (row.collab_enabled as number) !== 0,
  };
}

export function getRepoById(id: number): Repo | null {
  const row = getDb()
    .prepare("SELECT * FROM repos WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToRepo(row) : null;
}

export function getRepo(owner: string, name: string): Repo | null {
  validateName(owner, "owner");
  validateName(name, "repo");
  const row = getDb()
    .prepare("SELECT * FROM repos WHERE owner = ? AND name = ?")
    .get(owner, name) as Record<string, unknown> | undefined;
  return row ? rowToRepo(row) : null;
}

export function listRepos(): Repo[] {
  return (
    getDb()
      .prepare("SELECT * FROM repos ORDER BY created_at DESC")
      .all() as Record<string, unknown>[]
  ).map(rowToRepo);
}

export function updateRepo(
  owner: string,
  name: string,
  patch: Partial<
    Pick<Repo, "visibility" | "defaultBranch" | "proposalsEnabled" | "collabEnabled">
  >,
): Repo {
  const repo = getRepo(owner, name);
  if (!repo) throw new RegistryError("repo not found", "NOT_FOUND");

  const fields: string[] = [];
  const values: unknown[] = [];

  if (patch.visibility !== undefined) {
    if (patch.visibility !== "public" && patch.visibility !== "private") {
      throw new RegistryError("visibility must be public|private", "INVALID_INPUT");
    }
    fields.push("visibility = ?");
    values.push(patch.visibility);
  }
  if (patch.defaultBranch !== undefined) {
    if (typeof patch.defaultBranch !== "string" || !patch.defaultBranch) {
      throw new RegistryError("defaultBranch must be non-empty string", "INVALID_INPUT");
    }
    fields.push("default_branch = ?");
    values.push(patch.defaultBranch);
  }
  if (patch.proposalsEnabled !== undefined) {
    if (typeof patch.proposalsEnabled !== "boolean") {
      throw new RegistryError("proposalsEnabled must be a boolean", "INVALID_INPUT");
    }
    fields.push("proposals_enabled = ?");
    values.push(patch.proposalsEnabled ? 1 : 0);
  }
  if (patch.collabEnabled !== undefined) {
    if (typeof patch.collabEnabled !== "boolean") {
      throw new RegistryError("collabEnabled must be a boolean", "INVALID_INPUT");
    }
    fields.push("collab_enabled = ?");
    values.push(patch.collabEnabled ? 1 : 0);
  }

  if (fields.length === 0) return repo;

  values.push(repo.id);
  getDb().prepare(`UPDATE repos SET ${fields.join(", ")} WHERE id = ?`).run(...values);
  return getRepoById(repo.id)!;
}

function rowToPages(row: Record<string, unknown>): PagesConfig {
  const status = row.last_publish_status as string | null;
  return {
    repoId: row.repo_id as number,
    enabled: (row.enabled as number) === 1,
    sourceBranch: row.source_branch as string,
    sourcePath: row.source_path as string,
    targetContainer: row.target_container as string,
    lastPublishedAt: (row.last_published_at as number | null) ?? null,
    lastPublishStatus:
      status === "success" || status === "failed" || status === "needs-reauth"
        ? status
        : null,
    lastPublishError: (row.last_publish_error as string | null) ?? null,
    lastPublishAttempt: (row.last_publish_attempt as number | null) ?? null,
    lastPublishedSha: (row.last_published_sha as string | null) ?? null,
  };
}

export function getPagesConfig(repoId: number): PagesConfig | null {
  const row = getDb()
    .prepare("SELECT * FROM pages_configs WHERE repo_id = ?")
    .get(repoId) as Record<string, unknown> | undefined;
  return row ? rowToPages(row) : null;
}

export function updatePagesConfig(
  repoId: number,
  patch: Partial<Omit<PagesConfig, "repoId" | "lastPublishedAt">>,
): PagesConfig {
  const current = getPagesConfig(repoId);
  if (!current) throw new RegistryError("pages config not found", "NOT_FOUND");

  if (
    patch.targetContainer !== undefined &&
    patch.targetContainer !== "" &&
    !patch.targetContainer.startsWith("http")
  ) {
    throw new RegistryError(
      "targetContainer must be http(s) URL or empty",
      "INVALID_INPUT",
    );
  }
  if (
    patch.sourcePath !== undefined &&
    (typeof patch.sourcePath !== "string" || patch.sourcePath.includes(".."))
  ) {
    throw new RegistryError("sourcePath must not contain '..'", "INVALID_INPUT");
  }
  if (
    patch.sourceBranch !== undefined &&
    (typeof patch.sourceBranch !== "string" || patch.sourceBranch.length === 0)
  ) {
    throw new RegistryError("sourceBranch must be non-empty", "INVALID_INPUT");
  }

  const next: PagesConfig = {
    ...current,
    enabled: patch.enabled ?? current.enabled,
    sourceBranch: patch.sourceBranch ?? current.sourceBranch,
    sourcePath: patch.sourcePath ?? current.sourcePath,
    targetContainer: patch.targetContainer ?? current.targetContainer,
  };

  getDb()
    .prepare(
      `UPDATE pages_configs
         SET enabled = ?, source_branch = ?, source_path = ?, target_container = ?
       WHERE repo_id = ?`,
    )
    .run(
      next.enabled ? 1 : 0,
      next.sourceBranch,
      next.sourcePath,
      next.targetContainer,
      repoId,
    );

  return next;
}

export function markPagesPublished(
  repoId: number,
  options: { sha?: string | null; at?: number } = {},
): void {
  const at = options.at ?? Date.now();
  const sha = options.sha ?? null;
  getDb()
    .prepare(
      `UPDATE pages_configs
         SET last_published_at = ?,
             last_publish_status = 'success',
             last_publish_error = NULL,
             last_publish_attempt = ?,
             last_published_sha = COALESCE(?, last_published_sha)
       WHERE repo_id = ?`,
    )
    .run(at, at, sha, repoId);
}

export function markPagesFailed(
  repoId: number,
  status: "failed" | "needs-reauth",
  error: string,
  at: number = Date.now(),
): void {
  getDb()
    .prepare(
      `UPDATE pages_configs
         SET last_publish_status = ?,
             last_publish_error = ?,
             last_publish_attempt = ?
       WHERE repo_id = ?`,
    )
    .run(status, error.slice(0, 500), at, repoId);
}
