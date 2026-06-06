-- Public issue proposals (the pod-native LDN inbox feature).
--
-- A non-owner — including an unauthenticated visitor — can *propose* an
-- issue, which lands as a Linked Data Notification in the owner's pod
-- inbox (`{podRoot}/codespaces/{repo}/inbox/`). The owner later accepts a
-- proposal (minting a `.mind` issue at todo) or dismisses it.
--
-- This flag lets an owner turn the public propose endpoint off per-repo.
-- Default on (1) so existing repos accept proposals after migrating.

ALTER TABLE repos ADD COLUMN proposals_enabled INTEGER NOT NULL DEFAULT 1;
