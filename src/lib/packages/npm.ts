import "server-only";
import type { PackageRecord } from "@/lib/packages/store";

/**
 * npm registry protocol helpers (see docs/PACKAGES-PLAN.md → npm phase).
 *
 * Publish is a single `PUT /:pkg` whose JSON body inlines the tarball,
 * base64-encoded, in `_attachments`. Install reads a "packument" (the
 * package document: all versions + dist-tags) and then GETs each version's
 * `dist.tarball` URL. We control that URL, so we point it back at the
 * bridge's own tarball route.
 *
 * These functions are pure (no I/O) so the parse/build logic is unit-tested
 * directly; the route does the content-store + index side effects.
 */

export type NpmAttachment = {
  content_type?: string;
  data: string; // base64
  length?: number;
};

export type NpmPublishBody = {
  _id?: string;
  name: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, NpmVersionManifest>;
  _attachments?: Record<string, NpmAttachment>;
};

export type NpmVersionManifest = {
  name: string;
  version: string;
  dist?: { tarball?: string; shasum?: string; integrity?: string };
  [k: string]: unknown;
};

export type ParsedNpmPublish = {
  name: string;
  version: string;
  manifest: NpmVersionManifest;
  tarballFilename: string;
  tarballBytes: Uint8Array;
  distTags: Record<string, string>;
};

export class NpmPublishError extends Error {}

/**
 * Pull the single new version + its tarball out of an `npm publish` body.
 * npm sends exactly one entry under `versions` and one under `_attachments`
 * per publish.
 */
export function parseNpmPublish(body: NpmPublishBody): ParsedNpmPublish {
  if (!body || typeof body.name !== "string" || !body.name) {
    throw new NpmPublishError("publish body missing package name");
  }
  const versions = body.versions ?? {};
  const versionKeys = Object.keys(versions);
  if (versionKeys.length !== 1) {
    throw new NpmPublishError(
      `expected exactly one version in publish body, got ${versionKeys.length}`,
    );
  }
  const version = versionKeys[0];
  const manifest = versions[version];

  const attachments = body._attachments ?? {};
  const attachmentKeys = Object.keys(attachments);
  if (attachmentKeys.length !== 1) {
    throw new NpmPublishError(
      `expected exactly one tarball attachment, got ${attachmentKeys.length}`,
    );
  }
  const tarballFilename = attachmentKeys[0];
  const att = attachments[tarballFilename];
  if (!att || typeof att.data !== "string") {
    throw new NpmPublishError("attachment is missing base64 data");
  }
  const tarballBytes = new Uint8Array(Buffer.from(att.data, "base64"));

  return {
    name: body.name,
    version,
    manifest,
    tarballFilename,
    tarballBytes,
    distTags: body["dist-tags"] ?? {},
  };
}

/** Per-version metadata we persist in `packages.metadata_json`. */
export type NpmVersionMeta = {
  manifest: NpmVersionManifest;
  filename: string;
  distTags: Record<string, string>;
};

/**
 * Assemble a packument from the stored versions of a package. Each version's
 * `dist.tarball` is rewritten to a bridge URL; `dist.shasum`/`integrity` from
 * the original publish are preserved (the client computed them).
 *
 * `tarballBase` is the registry base for this repo, e.g.
 * `https://bridge/api/packages/npm/alice/mylib`. The resulting tarball URL is
 * `${tarballBase}/${name}/-/${filename}`.
 */
export function buildPackument(
  name: string,
  rows: PackageRecord[],
  tarballBase: string,
): {
  name: string;
  "dist-tags": Record<string, string>;
  versions: Record<string, NpmVersionManifest>;
} {
  const versions: Record<string, NpmVersionManifest> = {};
  let latest: string | null = null;
  let latestAt = -1;

  for (const row of rows) {
    const meta = (row.metadata as NpmVersionMeta | null) ?? null;
    const manifest: NpmVersionManifest = {
      ...(meta?.manifest ?? { name, version: row.version }),
    };
    const filename = meta?.filename ?? `${unscoped(name)}-${row.version}.tgz`;
    manifest.dist = {
      ...(manifest.dist ?? {}),
      tarball: `${trimSlash(tarballBase)}/${name}/-/${filename}`,
    };
    versions[row.version] = manifest;

    // "latest" = the version most recently published that tagged itself
    // latest, falling back to the newest row overall.
    const taggedLatest = meta?.distTags?.latest === row.version;
    if (taggedLatest && row.createdAt > latestAt) {
      latest = row.version;
      latestAt = row.createdAt;
    }
  }
  if (!latest && rows.length > 0) {
    // rows are newest-first from listVersions
    latest = rows[0].version;
  }

  return {
    name,
    "dist-tags": latest ? { latest } : {},
    versions,
  };
}

/** Find the stored version whose tarball filename matches `filename`. */
export function findVersionByFilename(
  rows: PackageRecord[],
  filename: string,
): PackageRecord | null {
  for (const row of rows) {
    const meta = row.metadata as NpmVersionMeta | null;
    if (meta?.filename === filename) return row;
  }
  return null;
}

function unscoped(name: string): string {
  const slash = name.indexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
