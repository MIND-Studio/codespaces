import "server-only";
import { getDb } from "@/lib/registry/db";

/**
 * The `packages` index — one row per published artifact version. Bytes live
 * in the pod CAS (see content-store.ts); this is the relational map from a
 * (repo, type, name, version) to a blob digest + format-specific metadata.
 */

export type PackageType = "npm" | "oci" | "file";

export type PackageRecord = {
  id: number;
  repoId: number;
  type: PackageType;
  name: string;
  version: string;
  digest: string;
  sizeBytes: number;
  contentType: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: number;
};

export class PackageError extends Error {
  constructor(
    message: string,
    public readonly code: "INVALID_NAME" | "INVALID_VERSION" | "INVALID_TYPE",
  ) {
    super(message);
  }
}

// npm names allow an optional `@scope/` prefix; everything else is a single
// path-segment-safe token. No `..`, no leading/trailing slash.
const NPM_NAME_RE = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
// File / image names and versions: a single segment of safe characters.
const SEGMENT_RE = /^[a-z0-9][a-z0-9._+-]*$/i;
// OCI image names: lowercase path components separated by `/` (the Docker
// "repository name" grammar), e.g. `myimage` or `team/service`.
const OCI_NAME_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/;
// A content digest, e.g. `sha256:<hex>` — a valid OCI manifest reference.
const DIGEST_RE = /^sha(?:256|512):[a-f0-9]{32,128}$/i;

export function validatePackageName(name: string, type: PackageType): void {
  let pattern: RegExp;
  if (type === "npm") pattern = NPM_NAME_RE;
  else if (type === "oci") pattern = OCI_NAME_RE;
  else pattern = SEGMENT_RE;
  const ok =
    typeof name === "string" && name.length <= 214 && !name.includes("..") && pattern.test(name);
  if (!ok) {
    throw new PackageError(`invalid ${type} package name: ${JSON.stringify(name)}`, "INVALID_NAME");
  }
}

/** A version is a normal segment (npm semver, file release) OR a content digest. */
export function validateVersion(version: string): void {
  if (
    typeof version !== "string" ||
    version.length === 0 ||
    version.length > 256 ||
    version.includes("..") ||
    !(SEGMENT_RE.test(version) || DIGEST_RE.test(version))
  ) {
    throw new PackageError(`invalid version: ${JSON.stringify(version)}`, "INVALID_VERSION");
  }
}

export function isDigestRef(ref: string): boolean {
  return DIGEST_RE.test(ref);
}

/**
 * Insert (or replace, on the same repo/type/name/version) a package version.
 * Replacing repoints the row at a new blob digest — re-publishing an
 * existing version is allowed and overwrites the index entry.
 */
export function upsertPackageVersion(input: {
  repoId: number;
  type: PackageType;
  name: string;
  version: string;
  digest: string;
  sizeBytes: number;
  contentType?: string | null;
  metadata?: Record<string, unknown> | null;
}): PackageRecord {
  validatePackageName(input.name, input.type);
  validateVersion(input.version);

  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO packages
         (repo_id, type, name, version, digest, size_bytes, content_type, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (repo_id, type, name, version) DO UPDATE SET
         digest = excluded.digest,
         size_bytes = excluded.size_bytes,
         content_type = excluded.content_type,
         metadata_json = excluded.metadata_json`,
    )
    .run(
      input.repoId,
      input.type,
      input.name,
      input.version,
      input.digest,
      input.sizeBytes,
      input.contentType ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      now,
    );

  return getPackageVersion(input.repoId, input.type, input.name, input.version)!;
}

export function getPackageVersion(
  repoId: number,
  type: PackageType,
  name: string,
  version: string,
): PackageRecord | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM packages
        WHERE repo_id = ? AND type = ? AND name = ? AND version = ?`,
    )
    .get(repoId, type, name, version) as Record<string, unknown> | undefined;
  return row ? rowToRecord(row) : null;
}

/** All versions of one package, newest first. */
export function listVersions(repoId: number, type: PackageType, name: string): PackageRecord[] {
  return (
    getDb()
      .prepare(
        `SELECT * FROM packages
          WHERE repo_id = ? AND type = ? AND name = ?
          ORDER BY created_at DESC`,
      )
      .all(repoId, type, name) as Record<string, unknown>[]
  ).map(rowToRecord);
}

/** Every package version in a repo (optionally filtered by type), newest first. */
export function listPackages(repoId: number, type?: PackageType): PackageRecord[] {
  const rows = type
    ? getDb()
        .prepare(`SELECT * FROM packages WHERE repo_id = ? AND type = ? ORDER BY created_at DESC`)
        .all(repoId, type)
    : getDb()
        .prepare(`SELECT * FROM packages WHERE repo_id = ? ORDER BY created_at DESC`)
        .all(repoId);
  return (rows as Record<string, unknown>[]).map(rowToRecord);
}

function rowToRecord(row: Record<string, unknown>): PackageRecord {
  const meta = row.metadata_json as string | null;
  return {
    id: row.id as number,
    repoId: row.repo_id as number,
    type: row.type as PackageType,
    name: row.name as string,
    version: row.version as string,
    digest: row.digest as string,
    sizeBytes: row.size_bytes as number,
    contentType: (row.content_type as string | null) ?? null,
    metadata: meta ? (JSON.parse(meta) as Record<string, unknown>) : null,
    createdAt: row.created_at as number,
  };
}
