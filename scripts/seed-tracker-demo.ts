/**
 * Seed a demo repo whose Issues board is driven by a `.mind` tracker.
 *
 * The bridge's `/repos/{o}/{r}/issues` UI renders the repo's
 * `.mind/build/{tracker,epics,state}.ttl` trio straight from the pushed git
 * history (see src/lib/tracker/). This script pushes *this prototype's own*
 * `.mind/build` trio into `alice/codespaces-tracker` so there's a real,
 * epic-rich tracker to look at.
 *
 * Idempotent: re-running force-pushes the current trio.
 *
 * Usage:
 *   docker compose up -d        # CSS on :3011
 *   npm run dev                  # bridge on :3010
 *   npm run seed:tracker
 */
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BRIDGE = process.env.BRIDGE_URL ?? "http://localhost:3010";
const POD_BASE = process.env.POD_BASE_URL ?? "http://localhost:3011/";
const OWNER = "alice";
const REPO = "codespaces-tracker";
const OWNER_WEBID = `${POD_BASE}${OWNER}/profile/card#me`;
const OWNER_POD_ROOT = `${POD_BASE}${OWNER}/`;

const SEED_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "X-Mind-Dev-WebId": OWNER_WEBID,
};

// This prototype's own `.mind/` tree (authoring source + built trio) is the demo
// tracker. We push the WHOLE folder so the repo carries the event-sourced source
// (issues/ + tracker.config.md + epics) — the "New issue" path re-folds it.
const SOURCE_MIND = join(process.cwd(), ".mind");

const README = `# ${OWNER}/${REPO}

Demo repo for the **\`.mind\` tracker → codespaces Issues** integration.

Its \`.mind/build/{tracker,epics,state}.ttl\` trio is a SolidOS-conformant
\`flow:Tracker\` folded from a \`.mind/issues/\` event log. The bridge renders it,
grouped by epic, at the **Issues** tab — read-only, sourced from this git history.
`;

async function ensureRepo(): Promise<void> {
  const existing = await fetch(`${BRIDGE}/api/repos/${OWNER}/${REPO}`);
  if (existing.ok) {
    console.log("[seed-tracker] repo exists, reusing");
    return;
  }
  const res = await fetch(`${BRIDGE}/api/repos`, {
    method: "POST",
    headers: SEED_HEADERS,
    body: JSON.stringify({
      owner: OWNER,
      name: REPO,
      ownerWebId: OWNER_WEBID,
      ownerPodRoot: OWNER_POD_ROOT,
      visibility: "public",
    }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`POST /api/repos: ${res.status} ${await res.text()}`);
  }
  console.log("[seed-tracker] repo created");
}

async function mintToken(): Promise<string> {
  const res = await fetch(`${BRIDGE}/api/repos/${OWNER}/${REPO}/tokens`, {
    method: "POST",
    headers: SEED_HEADERS,
    body: JSON.stringify({ label: `seed-tracker ${new Date().toISOString()}` }),
  });
  if (!res.ok) throw new Error(`POST tokens: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function pushTracker(token: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), `mind-codespaces-tracker-`));
  try {
    // Copy the whole .mind/ tree (authoring source + build trio) + a README.
    await cp(SOURCE_MIND, join(dir, ".mind"), { recursive: true });
    await writeFile(join(dir, "README.md"), README, "utf-8");
    await git(["init", "-b", "main"], dir);
    await git(["config", "user.email", "seed@mind-codespaces.local"], dir);
    await git(["config", "user.name", "seed-tracker"], dir);
    await git(["add", "."], dir);
    // `.mind/.gitignore` ignores `build/` (generated in the dev repo); the hosted
    // tracker repo serves the trio the board reads, so force it in.
    await git(["add", "-f", ".mind/build"], dir);
    await git(["commit", "-m", "seed: .mind tracker (source + built trio)"], dir);
    const remote = `http://seed:${token}@localhost:3010/api/git/${OWNER}/${REPO}.git`;
    await git(["remote", "add", "origin", remote], dir);
    await git(["push", "-f", "origin", "main"], dir);
    console.log("[seed-tracker] pushed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function git(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git ${args.join(" ")} failed: ${stderr}`));
    });
  });
}

async function main(): Promise<void> {
  await ensureRepo();
  const token = await mintToken();
  await pushTracker(token);
  console.log(
    `[seed-tracker] done. open ${BRIDGE}/repos/${OWNER}/${REPO}/issues`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
