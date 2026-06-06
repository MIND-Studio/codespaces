import "server-only";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { checkoutBranchToTempDir } from "@/lib/git/checkout";
import { buildTrackerOutputs, TrackerBuildError } from "./build";
import { parseTrackerTrio } from "./parse";

/**
 * Create a new `.mind` issue in a repo the bridge hosts, the event-sourced way:
 * check the branch out, write the issue's `issue.md` + an append-only `open`
 * event, re-fold the whole `.mind/issues/` tree into the `build/*.ttl` trio, then
 * commit + push. The git-sourced Issues board reads `build/state.ttl` from HEAD,
 * so the new issue appears once the push lands. `.mind` stays the authoring
 * layer; this is just another author writing the same two markdown files.
 */

export class IssueAuthorError extends Error {
  /** HTTP-ish status the API should surface (400 bad input, 409 no tracker, 500 git). */
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "IssueAuthorError";
    this.status = status;
  }
}

export type CreateIssueInput = {
  title: string;
  /** Category id from tracker.config.md (feature/bug/refactor/chore/docs). */
  type: string;
  /** Epic slug, or null/"general" for the un-epic'd lane. */
  epicSlug?: string | null;
  /** urgent | high | normal | low. */
  priority?: string;
  /** Markdown body. */
  body?: string;
  /** The signed-in author's WebID. */
  authorWebId: string;
};

export type CreateIssueResult = { id: string; number: number; slug: string };

const PRIORITIES = new Set(["urgent", "high", "normal", "low"]);
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const GENERAL_DIR = "00_general_issues"; // un-epic'd lane
const ENTRY_DIR_RE = /^\d{8,}_[a-z0-9]{4}$/; // <unix-seconds>_<rand4>

/** 4 lowercase base36 chars — the random, collision-breaking half of an address. */
function rand4(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const b = randomBytes(4);
  let s = "";
  for (let i = 0; i < 4; i++) s += alphabet[b[i] % 36];
  return s;
}

/**
 * `<unix-seconds>_<rand4>` — the stable on-disk address for an epic or issue dir.
 * The timestamp gives chronological `ls` order; the random suffix makes it
 * collision-free without a central counter (two agents can mint offline).
 */
function entryDirName(): string {
  return `${Math.floor(Date.now() / 1000)}_${rand4()}`;
}

/** Read an epic dir's epic.md `id` (its stable slug), or null if absent. */
function readEpicId(issuesDir: string, dirName: string): string | null {
  const epicFile = join(issuesDir, dirName, "epic.md");
  if (!existsSync(epicFile)) return null;
  const m = readFileSync(epicFile, "utf8").match(/^id:\s*(.+?)\s*$/m);
  return m ? m[1] : null;
}

/** The on-disk epic dir whose epic.md `id` matches `slug`, or null. */
function findEpicDirName(issuesDir: string, slug: string): string | null {
  if (!existsSync(issuesDir)) return null;
  for (const name of readdirSync(issuesDir)) {
    if (!ENTRY_DIR_RE.test(name)) continue;
    if (!statSync(join(issuesDir, name)).isDirectory()) continue;
    if (readEpicId(issuesDir, name) === slug) return name;
  }
  return null;
}

/** A ULID-ish id ending in `OPEN<NNNN>` so the build derives the display number. */
function mintIssueId(number: number): string {
  let t = Date.now();
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const rnd = randomBytes(6);
  let rand = "";
  for (let i = 0; i < 6; i++) rand += CROCKFORD[rnd[i] % 32];
  return `${time}${rand}OPEN${String(number).padStart(4, "0")}`;
}

function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return /^[a-z0-9]/.test(s) ? s : `issue-${s}`.replace(/-+$/g, "") || "issue";
}

/** A short [a-z0-9] actor tag for the event filename (cosmetic — fold reads frontmatter). */
function actorTag(webId: string): string {
  const local = webId.replace(/#.*$/, "").replace(/\/$/, "").split("/").pop() ?? "user";
  const tag = local.toLowerCase().replace(/[^a-z0-9]/g, "");
  return tag || "user";
}

function displayName(webId: string): string {
  return webId.replace(/#.*$/, "").replace(/\/$/, "").split("/").pop() ?? "mind-user";
}

function git(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`)),
    );
  });
}

function issueFrontmatter(opts: {
  id: string;
  slug: string;
  type: string;
  title: string;
  authorWebId: string;
  createdIso: string;
  epicSlug?: string;
}): string {
  const lines = [
    "---",
    `id: ${opts.id}`,
    `slug: ${opts.slug}`,
    `type: ${opts.type}`,
    `title: ${JSON.stringify(opts.title)}`,
    `author: ${JSON.stringify(opts.authorWebId)}`,
    "authorKind: human",
    `created: ${opts.createdIso}`,
  ];
  if (opts.epicSlug) lines.push(`epic: ${opts.epicSlug}`);
  lines.push("afk: false");
  lines.push("---");
  return lines.join("\n") + "\n";
}

function openEventFrontmatter(opts: {
  id: string;
  authorWebId: string;
  atIso: string;
  type: string;
  priority: string;
  epicSlug?: string;
}): string {
  const lines = [
    "---",
    `id: ${opts.id}`,
    "kind: open",
    `actor: ${JSON.stringify(opts.authorWebId)}`,
    "actorKind: human",
    `at: ${opts.atIso}`,
    "to: todo",
    `type: ${opts.type}`,
    `priority: ${opts.priority}`,
  ];
  if (opts.epicSlug) lines.push(`epic: ${opts.epicSlug}`);
  lines.push("---");
  return lines.join("\n") + "\n";
}

export async function createMindIssue(
  bareRepoPath: string,
  owner: string,
  name: string,
  input: CreateIssueInput,
  branch = "main",
): Promise<CreateIssueResult> {
  const title = input.title.trim();
  if (!title) throw new IssueAuthorError("title is required");
  const priority = input.priority && PRIORITIES.has(input.priority) ? input.priority : "normal";

  let checkout: { tempDir: string; cleanup: () => Promise<void> };
  try {
    checkout = await checkoutBranchToTempDir(bareRepoPath, branch);
  } catch (e) {
    throw new IssueAuthorError(
      `could not check out "${branch}": ${(e as Error).message}`,
      500,
    );
  }
  const { tempDir, cleanup } = checkout;

  try {
    // Fold the current tree to validate the tracker exists and to learn the
    // category/epic vocab + the highest existing issue number.
    let current;
    try {
      current = buildTrackerOutputs(tempDir);
    } catch (e) {
      if (e instanceof TrackerBuildError) {
        throw new IssueAuthorError(
          `this repo has no usable .mind tracker (${e.message})`,
          409,
        );
      }
      throw e;
    }
    const tracker = parseTrackerTrio(
      {
        tracker: current.outputs["tracker.ttl"],
        epics: current.outputs["epics.ttl"],
        state: current.outputs["state.ttl"],
      },
      owner,
      name,
    );
    if (!tracker) throw new IssueAuthorError("this repo has no .mind tracker", 409);

    // The form sends the lowercase config id (the category's rdfs:label, e.g.
    // "feature"); the parser also exposes the PascalCase class id ("Feature").
    // Accept either, and write the lowercase config id into the `.mind` source —
    // that's what the fold validates against (tracker.config.md category ids).
    const wanted = input.type.toLowerCase();
    const category = tracker.categories.find(
      (c) => c.label.toLowerCase() === wanted || c.id.toLowerCase() === wanted,
    );
    if (!category) {
      throw new IssueAuthorError(
        `unknown type "${input.type}" (expected one of: ${tracker.categories
          .map((c) => c.label)
          .join(", ")})`,
      );
    }
    const typeId = category.label;

    const wantsEpic = input.epicSlug && input.epicSlug !== "general";
    const epic = wantsEpic
      ? tracker.epics.find((e) => e.slug === input.epicSlug)
      : undefined;
    if (wantsEpic && !epic) {
      throw new IssueAuthorError(`unknown epic "${input.epicSlug}"`);
    }

    const nextNumber =
      tracker.issues.reduce((max, i) => Math.max(max, i.number ?? 0), 0) + 1;
    const id = mintIssueId(nextNumber);
    const slug = slugify(title);

    const now = new Date();
    const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const hhmm =
      String(now.getUTCHours()).padStart(2, "0") +
      String(now.getUTCMinutes()).padStart(2, "0");
    const tag = actorTag(input.authorWebId);

    const issuesDir = join(tempDir, ".mind", "issues");
    let groupRel = GENERAL_DIR;
    if (epic) {
      const found = findEpicDirName(issuesDir, epic.slug);
      if (!found) throw new IssueAuthorError(`epic "${epic.slug}" not found on disk`, 500);
      groupRel = found;
    }

    // On-disk address: <unix-seconds>_<rand4>. Regenerate the suffix on the
    // (vanishingly rare) same-second collision.
    let entry = entryDirName();
    while (existsSync(join(issuesDir, groupRel, entry))) entry = entryDirName();
    const issueRel = `${groupRel}/${entry}`;
    const issueDir = join(issuesDir, issueRel);
    const eventsDir = join(issueDir, "events");
    await mkdir(eventsDir, { recursive: true });

    const epicSlug = epic?.slug;
    await writeFile(
      join(issueDir, "issue.md"),
      issueFrontmatter({
        id,
        slug,
        type: typeId,
        title,
        authorWebId: input.authorWebId,
        createdIso: now.toISOString(),
        epicSlug,
      }) + (input.body?.trim() ? `\n${input.body.trim()}\n` : ""),
      "utf-8",
    );
    await writeFile(
      join(eventsDir, `${date}-${hhmm}-${tag}-open.md`),
      openEventFrontmatter({
        id,
        authorWebId: input.authorWebId,
        atIso: now.toISOString(),
        type: typeId,
        priority,
        epicSlug,
      }) + "\nOpened via the codespaces Issues UI.\n",
      "utf-8",
    );

    // Re-fold with the new issue included and write the canonical trio.
    const rebuilt = buildTrackerOutputs(tempDir);
    const buildDir = join(tempDir, ".mind", "build");
    await mkdir(buildDir, { recursive: true });
    for (const [file, content] of Object.entries(rebuilt.outputs)) {
      await writeFile(join(buildDir, file), content, "utf-8");
    }

    // Commit + push back to the bare repo (fires post-receive; harmless for a
    // .mind-only change with no Pages/workflow config).
    try {
      await git(["add", "-A", ".mind"], tempDir);
      // `.mind/.gitignore` ignores `build/` (generated in the dev repo), but the
      // hosted tracker repo serves the trio the board reads — force it in.
      await git(["add", "-f", ".mind/build"], tempDir);
      await git(
        [
          "-c",
          `user.email=${input.authorWebId}`,
          "-c",
          `user.name=${displayName(input.authorWebId)}`,
          "commit",
          "-m",
          `issue: ${title} (#${nextNumber})`,
        ],
        tempDir,
      );
      await git(["push", "origin", `HEAD:${branch}`], tempDir);
    } catch (e) {
      throw new IssueAuthorError(`git write failed: ${(e as Error).message}`, 500);
    }

    return { id, number: nextNumber, slug };
  } finally {
    await cleanup();
  }
}

// ── Epics ─────────────────────────────────────────────────────────────────────

const EPIC_STATUSES = new Set(["planned", "active", "done", "parked"]);

export type CreateEpicInput = {
  title: string;
  /** Markdown body (the epic's Goal narrative). */
  body?: string;
  /** planned | active | done | parked (defaults to "planned"). */
  status?: string;
  /** The signed-in author's WebID. */
  authorWebId: string;
};

export type CreateEpicResult = { slug: string; number: number };

function epicFrontmatter(opts: {
  slug: string;
  title: string;
  status: string;
  createdYmd: string;
}): string {
  return (
    [
      "---",
      `id: ${opts.slug}`,
      `title: ${JSON.stringify(opts.title)}`,
      `status: ${opts.status}`,
      `created: ${opts.createdYmd}`,
      "---",
    ].join("\n") + "\n"
  );
}

/** Existing epic ids (each epic.md `id`) across the on-disk epic dirs. */
function listEpicSlugs(issuesDir: string): string[] {
  if (!existsSync(issuesDir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(issuesDir)) {
    if (!ENTRY_DIR_RE.test(name)) continue;
    if (!statSync(join(issuesDir, name)).isDirectory()) continue;
    const id = readEpicId(issuesDir, name);
    if (id) out.push(id);
  }
  return out;
}

/**
 * Create a new `.mind` **epic** (a goal grouping issues) the same way as an
 * issue: check the branch out, write `epic.md` into a fresh `<ts>_<rand4>/` dir,
 * re-fold the tree into the `build/*.ttl` trio, then commit + push. Epics have
 * no events/ log — the fold reads `epic.md` directly. A freshly created epic has
 * zero issues; the board renders it as an empty group until issues join it.
 */
export async function createMindEpic(
  bareRepoPath: string,
  owner: string,
  name: string,
  input: CreateEpicInput,
  branch = "main",
): Promise<CreateEpicResult> {
  const title = input.title.trim();
  if (!title) throw new IssueAuthorError("title is required");
  const status =
    input.status && EPIC_STATUSES.has(input.status) ? input.status : "planned";

  let checkout: { tempDir: string; cleanup: () => Promise<void> };
  try {
    checkout = await checkoutBranchToTempDir(bareRepoPath, branch);
  } catch (e) {
    throw new IssueAuthorError(
      `could not check out "${branch}": ${(e as Error).message}`,
      500,
    );
  }
  const { tempDir, cleanup } = checkout;

  try {
    // Validate the tracker exists (and is well-formed) before writing.
    try {
      buildTrackerOutputs(tempDir);
    } catch (e) {
      if (e instanceof TrackerBuildError) {
        throw new IssueAuthorError(
          `this repo has no usable .mind tracker (${e.message})`,
          409,
        );
      }
      throw e;
    }

    const issuesDir = join(tempDir, ".mind", "issues");
    const existing = listEpicSlugs(issuesDir);
    const nextNumber = existing.length + 1; // display position; the folder name is the address

    // The fold rejects two epics with the same id, so disambiguate a slug clash.
    let slug = slugify(title);
    if (existing.includes(slug)) slug = `${slug}-${nextNumber}`;

    // On-disk address: <unix-seconds>_<rand4>, regenerated on a same-second clash.
    let dir = entryDirName();
    while (existsSync(join(issuesDir, dir))) dir = entryDirName();
    const epicDir = join(issuesDir, dir);
    await mkdir(epicDir, { recursive: true });

    const now = new Date();
    await writeFile(
      join(epicDir, "epic.md"),
      epicFrontmatter({
        slug,
        title,
        status,
        createdYmd: now.toISOString().slice(0, 10),
      }) + (input.body?.trim() ? `\n${input.body.trim()}\n` : ""),
      "utf-8",
    );

    // Re-fold with the new epic included and write the canonical trio.
    const rebuilt = buildTrackerOutputs(tempDir);
    const buildDir = join(tempDir, ".mind", "build");
    await mkdir(buildDir, { recursive: true });
    for (const [file, content] of Object.entries(rebuilt.outputs)) {
      await writeFile(join(buildDir, file), content, "utf-8");
    }

    try {
      await git(["add", "-A", ".mind"], tempDir);
      await git(["add", "-f", ".mind/build"], tempDir);
      await git(
        [
          "-c",
          `user.email=${input.authorWebId}`,
          "-c",
          `user.name=${displayName(input.authorWebId)}`,
          "commit",
          "-m",
          `epic: ${title} (${slug})`,
        ],
        tempDir,
      );
      await git(["push", "origin", `HEAD:${branch}`], tempDir);
    } catch (e) {
      throw new IssueAuthorError(`git write failed: ${(e as Error).message}`, 500);
    }

    return { slug, number: nextNumber };
  } finally {
    await cleanup();
  }
}
