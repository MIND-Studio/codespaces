-- Live multiplayer (real-time co-authoring) on issue/epic drafts.
--
-- The draft composer (`/repos/{o}/{r}/issues/draft/{id}`) syncs through a
-- y-websocket relay so several people can co-write one draft with live
-- cursors. This flag lets an owner turn that off per-repo: when off, the
-- composer still works but edits stay local to the browser (IndexedDB) —
-- no relay connection, no presence, no co-authoring.
--
-- Default on (1) so existing repos keep today's collaborative behavior
-- after migrating.

ALTER TABLE repos ADD COLUMN collab_enabled INTEGER NOT NULL DEFAULT 1;
