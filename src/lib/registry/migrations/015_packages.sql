-- Mind Packages — registry index (see docs/PACKAGES-PLAN.md).
--
-- One row per published artifact *version*. The bytes live in the owner's
-- pod under a content-addressed CAS (public/packages/blobs/sha256/…); this
-- table is just the index that maps a (repo, type, name, version) to the
-- sha256 of its primary blob plus any format-specific metadata.
--
--   type:          'npm' | 'oci' | 'file'
--   name:          npm package name (may be '@scope/name'), filename, or image name
--   version:       semver / tag / release label
--   digest:        'sha256:<hex>' of the primary blob (npm tarball, the file, …)
--   size_bytes:    blob size, for the per-repo storage quota
--   content_type:  MIME to serve on download (npm tarballs are octet-stream)
--   metadata_json: format-specific extra (npm version manifest + filename + dist-tags)
--
-- Bytes are never GC'd in v0 — the CAS is append-only and dedup'd by digest.
-- Reference-counting + sweep is a documented follow-up.
CREATE TABLE packages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id       INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  type          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  version       TEXT    NOT NULL,
  digest        TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  content_type  TEXT,
  metadata_json TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (repo_id, type, name, version)
);

CREATE INDEX idx_packages_repo_type_name ON packages (repo_id, type, name);
