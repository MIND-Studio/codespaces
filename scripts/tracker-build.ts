#!/usr/bin/env tsx
/**
 * tracker-build CLI — render this repo's Markdown-authored, event-sourced
 * `.mind/issues/` tracker into canonical Turtle.
 *
 * The fold itself lives in `src/lib/tracker/build.ts` (`buildTrackerOutputs`) so
 * the bridge can run it server-side against a checked-out consumer repo (the
 * "create issue" path). This file is just the CLI: it points the fold at this
 * repo's root, then writes or diff-checks `build/*.ttl`.
 *
 *   .mind/issues/tracker.config.md               — YAML frontmatter: states, categories, axes (AUTHORITATIVE vocab)
 *   .mind/issues/<ts>_<rand>/epic.md             — the epic's goal/brief (id, title, status)
 *   .mind/issues/<ts>_<rand>/<ts>_<rand>/issue.md
 *   .mind/issues/<ts>_<rand>/<ts>_<rand>/events/<date>-<hhmm>-<actor>-<kind>.md
 *   .mind/issues/00_general_issues/<ts>_<rand>/  — un-epic'd issues
 *
 * Folder names are stable addresses (<unix-seconds>_<rand4>); identity (RDF
 * fragment, display number) comes from frontmatter, not the path.
 *
 * Output (canonical, committed):
 *   .mind/build/{tracker,epics,state}.ttl
 *
 * Usage:
 *   npm run tracker:build          # write build/*.ttl
 *   npm run tracker:check          # regenerate in memory, diff vs committed; exit 1 on drift
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTrackerOutputs, TrackerBuildError } from "../src/lib/tracker/build";

const REPO_ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const BUILD_DIR = join(REPO_ROOT, ".mind", "build");
const CHECK = process.argv.includes("--check");

try {
  const { outputs, epicCount, issueCount, config } = buildTrackerOutputs(REPO_ROOT);

  if (CHECK) {
    let drift = false;
    for (const [name, content] of Object.entries(outputs)) {
      const path = join(BUILD_DIR, name);
      const current = existsSync(path) ? readFileSync(path, "utf8") : null;
      if (current !== content) {
        drift = true;
        console.error(
          `tracker-build --check: ${relative(REPO_ROOT, path)} is out of date — run "npm run tracker:build".`,
        );
      }
    }
    if (drift) process.exit(1);
    console.log(`tracker-build --check: build/ is up to date (${epicCount} epics, ${issueCount} issues).`);
    process.exit(0);
  }

  if (!existsSync(BUILD_DIR)) mkdirSync(BUILD_DIR, { recursive: true });
  for (const [name, content] of Object.entries(outputs)) {
    writeFileSync(join(BUILD_DIR, name), content, "utf8");
  }
  console.log(
    `tracker-build: wrote build/tracker.ttl (${config.states} states, ${config.categories} categories) + build/epics.ttl (${epicCount} epics) + build/state.ttl (${issueCount} issues).`,
  );
} catch (e) {
  if (e instanceof TrackerBuildError) {
    console.error(`tracker-build: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
