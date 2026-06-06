/**
 * Import an existing local Git repository into the bridge as a new repo.
 *
 *   npm run import:repo -- [--source DIR] [--owner OWNER] [--name NAME] [--branch BRANCH]
 *
 * Defaults are tuned for the `mind/compass` example:
 *   --source  ~/develop/mind/compass
 *   --owner   mind
 *   --name    compass
 *   --branch  main
 *
 * The script does NOT modify the source repository — it `git push`es to
 * a one-shot URL with credentials baked in, no `git remote add` involved.
 */
import { spawn } from "node:child_process";

type Args = {
  source: string;
  owner: string;
  name: string;
  branch: string;
};

const BRIDGE = process.env.BRIDGE_URL ?? "http://localhost:3010";
const POD_BASE = process.env.POD_BASE_URL ?? "http://localhost:3011/";

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback: string) => {
    const i = argv.indexOf(flag);
    if (i < 0 || i + 1 >= argv.length) return fallback;
    return argv[i + 1];
  };
  return {
    source: get("--source", `${process.env.HOME}/develop/mind/compass`),
    owner: get("--owner", "mind"),
    name: get("--name", "compass"),
    branch: get("--branch", "main"),
  };
}

async function main() {
  const { source, owner, name, branch } = parseArgs();
  const ownerWebId = `${POD_BASE}${owner}/profile/card#me`;
  const ownerPodRoot = `${POD_BASE}${owner}/`;

  console.log(`[import] source=${source}`);
  console.log(`[import] target=${owner}/${name}@${branch}`);
  console.log(`[import] owner pod=${ownerPodRoot}`);

  await ensureRepo(owner, name, ownerWebId, ownerPodRoot);
  const token = await mintToken(owner, name);
  await pushFromSource(source, owner, name, branch, token);

  console.log("");
  console.log(`[import] done`);
  console.log(`[import]   dashboard: ${BRIDGE}/repos/${owner}/${name}`);
  console.log(`[import]   browse:    ${BRIDGE}/repos/${owner}/${name}/tree`);
}

async function ensureRepo(
  owner: string,
  name: string,
  ownerWebId: string,
  ownerPodRoot: string,
): Promise<void> {
  const existing = await fetch(`${BRIDGE}/api/repos/${owner}/${name}`);
  if (existing.ok) {
    console.log("[import] repo exists, reusing");
    return;
  }
  const res = await fetch(`${BRIDGE}/api/repos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mind-Dev-WebId": ownerWebId,
    },
    body: JSON.stringify({
      owner,
      name,
      ownerWebId,
      ownerPodRoot,
      visibility: "public",
    }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`POST /api/repos: ${res.status} ${await res.text()}`);
  }
  console.log("[import] repo created");
}

async function mintToken(owner: string, name: string): Promise<string> {
  const ownerWebId = `${POD_BASE}${owner}/profile/card#me`;
  const res = await fetch(`${BRIDGE}/api/repos/${owner}/${name}/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Mind-Dev-WebId": ownerWebId,
    },
    body: JSON.stringify({ label: `import-repo ${new Date().toISOString()}` }),
  });
  if (!res.ok) throw new Error(`POST tokens: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function pushFromSource(
  source: string,
  owner: string,
  name: string,
  branch: string,
  token: string,
): Promise<void> {
  // Bridge URL with embedded HTTP-Basic credentials. Username is ignored
  // by the bridge — only the password (token) matters.
  const url = `http://import:${token}@localhost:3010/api/git/${owner}/${name}.git`;
  // Force-push so re-runs reset the bridge's view to the source's current ref.
  await git(["push", "-f", url, `${branch}:${branch}`], source);
  console.log(`[import] pushed ${branch}`);
}

function git(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        // Echo git's output for visibility, but only on success (errors
        // already contain it).
        if (stdout.trim()) console.log(stdout.trim());
        if (stderr.trim()) console.log(stderr.trim());
        resolve();
      } else {
        reject(
          new Error(`git ${args.join(" ")} exited ${code}: ${stderr || stdout}`),
        );
      }
    });
  });
}

main().catch((err) => {
  console.error("[import] failed:", err);
  process.exit(1);
});
