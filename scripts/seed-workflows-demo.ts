/**
 * Seed three workflow-demo repos against a running bridge. Each repo
 * exercises a different workflow shape so the runs page tells a story:
 *
 *   1. alice/marked-blog   — real `npm install` + `marked` builds a
 *                            three-post blog (multi-file output, real deps).
 *   2. alice/tailwind-site — real `npm install` + Tailwind v4 CLI builds a
 *                            styled landing page (multi-step shell).
 *   3. alice/broken-build  — deliberately fails mid-batch so the runs
 *                            page shows a red failure next to the greens.
 *
 * Idempotent: re-running force-pushes new commits.
 *
 * Usage:
 *   docker compose up -d         # CSS on :3011
 *   npm run dev                  # bridge on :3010
 *   npm run seed:workflows
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BRIDGE = process.env.BRIDGE_URL ?? "http://localhost:3010";
const POD_BASE = process.env.POD_BASE_URL ?? "http://localhost:3011/";
const OWNER = "alice";
const OWNER_WEBID = `${POD_BASE}${OWNER}/profile/card#me`;
const OWNER_POD_ROOT = `${POD_BASE}${OWNER}/`;

// Dev-only session bypass — see src/lib/auth/session.ts:requireSession.
const SEED_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "X-Mind-Dev-WebId": OWNER_WEBID,
};

// Workflow runs that install npm deps inside a fresh Docker container
// can take a minute or two, especially on the first run when the image
// hasn't been pulled yet. Don't time out before that finishes.
const RUN_POLL_MAX_MS = 5 * 60 * 1000;
const RUN_POLL_INTERVAL_MS = 1500;

type Repo = {
  name: string;
  files: Record<string, string>;
  expectsSuccess: boolean;
  blurb: string;
};

// ---------------------------------------------------------------------------
// marked-blog
// ---------------------------------------------------------------------------

const MARKED_PACKAGE_JSON = JSON.stringify(
  {
    name: "marked-blog",
    private: true,
    type: "module",
    dependencies: { marked: "^14.1.3" },
  },
  null,
  2,
);

const MARKED_BUILD = `#!/usr/bin/env node
// Render every post in posts/*.md to dist/{slug}.html plus an
// dist/index.html that lists them in reverse-chronological order.
import { mkdirSync, readFileSync, readdirSync, writeFileSync, cpSync, existsSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const POSTS_DIR = "posts";
const OUT_DIR = "dist";
const STYLE_SRC = "assets/style.css";

function shell(html, title) {
  return \`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>\${title}</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header><a href="index.html">marked-blog</a></header>
  <main>\${html}</main>
  <footer>
    <p>Built by <code>node scripts/build.mjs</code> inside a Mind Codespaces
       workflow runner (Docker, node:22-alpine). Source: a folder of
       markdown files.</p>
  </footer>
</body>
</html>
\`;
}

mkdirSync(OUT_DIR, { recursive: true });

if (existsSync(STYLE_SRC)) {
  cpSync(STYLE_SRC, join(OUT_DIR, "style.css"));
}

const files = readdirSync(POSTS_DIR).filter((f) => f.endsWith(".md")).sort().reverse();
const summaries = [];

for (const file of files) {
  const slug = file.replace(/\\.md$/, "");
  const md = readFileSync(join(POSTS_DIR, file), "utf-8");
  const firstLine = md.split("\\n").find((l) => l.startsWith("# "));
  const title = firstLine ? firstLine.replace(/^# /, "").trim() : slug;
  const body = await marked.parse(md);
  writeFileSync(join(OUT_DIR, \`\${slug}.html\`), shell(body, title), "utf-8");
  summaries.push({ slug, title, date: slug.slice(0, 10) });
  console.log(\`rendered \${file} → \${slug}.html\`);
}

const indexBody = \`<h1>marked-blog</h1>
<p class="lede">Posts written in markdown, rendered to HTML by a workflow.</p>
<ul class="posts">
\${summaries
  .map((s) => \`  <li><time>\${s.date}</time> · <a href="\${s.slug}.html">\${s.title}</a></li>\`)
  .join("\\n")}
</ul>\`;

writeFileSync(join(OUT_DIR, "index.html"), shell(indexBody, "marked-blog"), "utf-8");
console.log(\`wrote dist/index.html (\${summaries.length} posts indexed)\`);
`;

const MARKED_STYLE = `:root {
  --paper: #fbfaf6;
  --paper-soft: #f4f1eb;
  --ink: #1f1d1a;
  --ink-soft: #524d45;
  --ink-faint: #8a8378;
  --ink-trace: #d7d1c4;
  --accent: #c4801d;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #16191a;
    --paper-soft: #1c2120;
    --ink: #ecead8;
    --ink-soft: #b6b1a0;
    --ink-faint: #7c7868;
    --ink-trace: #383d39;
    --accent: #e5a44a;
  }
}
* { box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
  max-width: 38rem;
  margin: 3rem auto 5rem auto;
  padding: 0 1.2rem;
  color: var(--ink);
  background: var(--paper);
  line-height: 1.6;
}
header {
  border-bottom: 1px solid var(--ink-trace);
  padding-bottom: 0.6rem;
  margin-bottom: 2rem;
  font-family: "JetBrains Mono", Menlo, monospace;
  font-size: 0.75rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
header a {
  color: var(--ink-soft);
  text-decoration: none;
}
h1 {
  font-family: Georgia, serif;
  font-size: 2.1rem;
  letter-spacing: -0.015em;
  margin-bottom: 0.3rem;
}
h2 { font-family: Georgia, serif; font-size: 1.3rem; margin-top: 2rem; }
p.lede { color: var(--ink-soft); }
ul.posts { padding-left: 0; list-style: none; }
ul.posts li {
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--ink-trace);
}
ul.posts time {
  font-family: "JetBrains Mono", Menlo, monospace;
  font-size: 0.78rem;
  color: var(--ink-faint);
  margin-right: 0.4rem;
}
a { color: var(--accent); }
code {
  font-family: "JetBrains Mono", Menlo, monospace;
  background: var(--paper-soft);
  border: 1px solid var(--ink-trace);
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  font-size: 0.88em;
}
pre code { background: none; border: none; padding: 0; }
pre {
  background: var(--paper-soft);
  border: 1px solid var(--ink-trace);
  padding: 0.7rem 0.9rem;
  border-radius: 4px;
  overflow-x: auto;
  font-size: 0.82rem;
}
blockquote {
  border-left: 3px solid var(--accent);
  margin: 1.2rem 0;
  padding: 0.3rem 0.9rem;
  color: var(--ink-soft);
  background: var(--paper-soft);
}
footer {
  margin-top: 3rem;
  padding-top: 1rem;
  border-top: 1px solid var(--ink-trace);
  font-size: 0.82rem;
  color: var(--ink-faint);
}
`;

const MARKED_WORKFLOW = `run:
  - npm install --no-audit --no-fund
  - node scripts/build.mjs
publish: dist
timeout: 600
`;

const MARKED_POST_1 = `# Welcome to marked-blog

A static blog whose **source is three markdown files** and whose **build runs in
a Mind Codespaces workflow** — meaning a Docker container on the bridge, not a
SaaS CI.

Push triggers the workflow. The workflow installs \`marked\`, runs
\`node scripts/build.mjs\`, and the bridge takes the resulting \`dist/\` folder
and publishes it to a Solid pod container the author owns. No GitHub Pages,
no Netlify, no Cloudflare.

\`\`\`yaml
# .mind/workflow.yml
run:
  - npm install --no-audit --no-fund
  - node scripts/build.mjs
publish: dist
\`\`\`

> The site lives on the author's pod. The bridge can rebuild it on every
> push, but can't take it down — they could swap to any other Solid host
> tomorrow with the same content.
`;

const MARKED_POST_2 = `# Why a pod, not a platform

Most static-site hosts make a quiet trade: you publish, they host, they own
the URL. If they shut down — or you stop paying — the URL goes away. Your
audience's bookmarks break. Your search-engine equity goes with it.

A Solid pod inverts that. The URL is a path on your pod, served by *some*
pod host of your choosing. Move pods, change DNS, keep the URL working.
The bridge that publishes is replaceable — anyone could run another
instance — but the published artifact is yours.

## What you give up

- Free hosting at scale (you pay for the pod).
- One-click integration with cloud build pipelines.
- Edge CDN by default.

## What you gain

- A URL you can take with you.
- A clear separation: identity (WebID), data (pod), platform (bridge).
- The ability to walk away from any single platform without losing your audience.
`;

const MARKED_POST_3 = `# On running CI without a CI provider

This very post was published by an open-source workflow runner that exists
to prove a small point: **you don't need GitHub Actions to do CI**.

The runner is a few hundred lines. When you push, the bridge:

1. Detects \`.mind/workflow.yml\` in the new commit.
2. Spins up a \`node:22-alpine\` Docker container with your checkout bind-mounted.
3. Runs the listed shell commands with \`set -e\`.
4. If they all succeed and the workflow has \`publish:\`, hands the named
   directory to the pod publisher.

That's it. No queue service, no workflow file format borrowed from Azure,
no YAML matrices, no marketplace of third-party actions. Just \`sh -c\` inside
a fresh container.

The trade is honest: this runner doesn't scale to a thousand-repo
organisation, doesn't have parallel jobs, doesn't cache between runs. But
for "build my static site on push", it does the job in 200 lines.

> "The best CI system is the one with the smallest possible surface area
> that still solves your build."
`;

// ---------------------------------------------------------------------------
// tailwind-site
// ---------------------------------------------------------------------------

const TAILWIND_PACKAGE_JSON = JSON.stringify(
  {
    name: "tailwind-site",
    private: true,
    dependencies: {
      "@tailwindcss/cli": "^4.0.0",
      tailwindcss: "^4.0.0",
    },
  },
  null,
  2,
);

const TAILWIND_INPUT_CSS = `@import "tailwindcss";

@theme {
  --color-paper: #fbfaf6;
  --color-paper-soft: #f4f1eb;
  --color-ink: #1f1d1a;
  --color-ink-soft: #524d45;
  --color-ink-faint: #8a8378;
  --color-ink-trace: #d7d1c4;
  --color-accent: #c4801d;
  --color-accent-deep: #8a570f;
  --font-display: Georgia, "Times New Roman", serif;
  --font-mono: "JetBrains Mono", Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-paper: #16191a;
    --color-paper-soft: #1c2120;
    --color-ink: #ecead8;
    --color-ink-soft: #b6b1a0;
    --color-ink-faint: #7c7868;
    --color-ink-trace: #383d39;
    --color-accent: #e5a44a;
  }
}

body { background: var(--color-paper); color: var(--color-ink); }
`;

const TAILWIND_INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>tailwind-site · Mind Codespaces demo</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body class="min-h-screen">
  <main class="max-w-2xl mx-auto px-6 py-16">
    <p class="font-mono text-xs uppercase tracking-[0.22em] text-ink-faint mb-4">
      mind codespaces · workflow demo
    </p>
    <h1 class="font-display text-5xl leading-tight tracking-tight text-ink mb-3">
      Built with <em class="text-accent">Tailwind v4</em>,
      <br/>shipped to a Solid pod.
    </h1>
    <p class="text-lg text-ink-soft leading-relaxed">
      This page started life as an HTML file plus a single
      <code class="font-mono text-sm bg-paper-soft border border-ink-trace rounded px-1.5 py-0.5">@import "tailwindcss"</code>
      stylesheet. A workflow ran <code class="font-mono text-sm bg-paper-soft border border-ink-trace rounded px-1.5 py-0.5">npm install</code>,
      then the Tailwind CLI, then copied both files into <code class="font-mono text-sm bg-paper-soft border border-ink-trace rounded px-1.5 py-0.5">dist/</code>.
      The bridge published <code class="font-mono text-sm bg-paper-soft border border-ink-trace rounded px-1.5 py-0.5">dist/</code> to a container on alice's pod.
    </p>

    <div class="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div class="border border-ink-trace rounded-lg p-5 bg-paper-soft">
        <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint mb-1">step 1</p>
        <p class="font-display text-lg text-ink mb-1">Install Tailwind</p>
        <p class="text-sm text-ink-soft font-mono">npm install</p>
      </div>
      <div class="border border-ink-trace rounded-lg p-5 bg-paper-soft">
        <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint mb-1">step 2</p>
        <p class="font-display text-lg text-ink mb-1">Compile CSS</p>
        <p class="text-sm text-ink-soft font-mono">npx @tailwindcss/cli -i src/input.css -o dist/styles.css --minify</p>
      </div>
      <div class="border border-ink-trace rounded-lg p-5 bg-paper-soft">
        <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint mb-1">step 3</p>
        <p class="font-display text-lg text-ink mb-1">Copy HTML</p>
        <p class="text-sm text-ink-soft font-mono">cp src/index.html dist/</p>
      </div>
      <div class="border border-ink-trace rounded-lg p-5 bg-paper-soft">
        <p class="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-faint mb-1">step 4</p>
        <p class="font-display text-lg text-ink mb-1">Publish</p>
        <p class="text-sm text-ink-soft">Bridge uploads <code class="font-mono text-xs">dist/</code> to your pod.</p>
      </div>
    </div>

    <footer class="mt-16 pt-6 border-t border-ink-trace text-sm text-ink-faint">
      <p>
        Built in Docker (<code class="font-mono text-xs">node:22-alpine</code>) by a workflow
        living in <code class="font-mono text-xs">.mind/workflow.yml</code>. No GitHub Actions,
        no Netlify, no CDN. Source: a folder of files; output: a Solid pod URL.
      </p>
    </footer>
  </main>
</body>
</html>
`;

const TAILWIND_WORKFLOW = `run:
  - npm install --no-audit --no-fund
  - mkdir -p dist
  - npx @tailwindcss/cli -i src/input.css -o dist/styles.css --minify
  - cp src/index.html dist/index.html
publish: dist
timeout: 600
`;

// ---------------------------------------------------------------------------
// broken-build (deliberately fails)
// ---------------------------------------------------------------------------

// Note on the YAML: the test-step command is wrapped in OUTER double
// quotes because the inner string contains `expected: 42` — a colon
// followed by a space is parsed by YAML as a mapping separator in
// plain (unquoted) scalars. Outer-quoting it makes it a proper string.
const BROKEN_WORKFLOW = `run:
  - echo "[1/4] environment check"
  - node --version
  - echo "[2/4] lint — fine"
  - echo "no lint config in this demo, skipping"
  - echo "[3/4] tests — about to fail intentionally"
  - "sh -c 'echo expected: 42; echo actual: 41; exit 7'"
  - echo "[4/4] build — never runs because set -e stops on test failure"
publish: dist
`;

const BROKEN_README = `# broken-build

A workflow demo that **deliberately fails** at step 3 of 4 so the runs page
shows a red failure next to the greens.

\`\`\`yaml
# .mind/workflow.yml
run:
  - echo "[1/4] environment check"
  - node --version
  - echo "[2/4] lint — fine"
  - echo "no lint config in this demo, skipping"
  - echo "[3/4] tests — about to fail intentionally"
  - "sh -c 'echo expected: 42; echo actual: 41; exit 7'"
  - echo "[4/4] build — never runs because set -e stops on test failure"
publish: dist
\`\`\`

\`set -e\` semantics: the first command to exit non-zero stops the batch.
The run is marked **failed** with exit code **7**, and the step-4 echo
never appears in the log. \`publish:\` is declared but the publish step
never fires because the batch failed.
`;

// ---------------------------------------------------------------------------
// Repo list
// ---------------------------------------------------------------------------

const REPOS: Repo[] = [
  {
    name: "marked-blog",
    expectsSuccess: true,
    blurb: "npm install + marked → multi-page blog",
    files: {
      "package.json": MARKED_PACKAGE_JSON,
      "scripts/build.mjs": MARKED_BUILD,
      "assets/style.css": MARKED_STYLE,
      ".mind/workflow.yml": MARKED_WORKFLOW,
      "posts/2026-05-01-welcome.md": MARKED_POST_1,
      "posts/2026-05-15-why-pods.md": MARKED_POST_2,
      "posts/2026-05-22-on-ci.md": MARKED_POST_3,
      "README.md":
        "# marked-blog\n\nReal `npm install` + `marked` workflow demo.\n\nThe build script reads `posts/*.md` and writes `dist/{slug}.html` plus an index. Pushed via a Mind Codespaces seed; built in a Docker container; published to alice's Solid pod.\n",
    },
  },
  {
    name: "tailwind-site",
    expectsSuccess: true,
    blurb: "npm install + Tailwind v4 CLI pipeline",
    files: {
      "package.json": TAILWIND_PACKAGE_JSON,
      "src/input.css": TAILWIND_INPUT_CSS,
      "src/index.html": TAILWIND_INDEX_HTML,
      ".mind/workflow.yml": TAILWIND_WORKFLOW,
      "README.md":
        "# tailwind-site\n\nReal Tailwind v4 CLI workflow demo.\n\nThe workflow installs Tailwind, compiles `src/input.css` → `dist/styles.css` with `--minify`, copies the HTML, and the bridge publishes `dist/` to alice's Solid pod.\n",
    },
  },
  {
    name: "broken-build",
    expectsSuccess: false,
    blurb: "intentional failure (step 3 of 4)",
    files: {
      ".mind/workflow.yml": BROKEN_WORKFLOW,
      "README.md": BROKEN_README,
    },
  },
];

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[seed-workflows] bridge=${BRIDGE}`);
  console.log(`[seed-workflows] pod=${OWNER_POD_ROOT}`);

  for (const repo of REPOS) {
    console.log(`\n[seed-workflows] === ${OWNER}/${repo.name} (${repo.blurb}) ===`);
    await ensureRepo(repo);
    await ensurePagesConfig(repo);
    const token = await mintToken(repo);
    const lastSeenRunId = await latestRunId(repo);
    await pushSite(repo, token);
    const run = await waitForNewRun(repo, lastSeenRunId);
    if (run === null) {
      console.warn(`[seed-workflows] no run appeared within ${RUN_POLL_MAX_MS}ms`);
      continue;
    }
    const dur = ((run.finishedAt ?? Date.now()) - run.startedAt) / 1000;
    const mark =
      run.status === "success" && repo.expectsSuccess
        ? "OK"
        : run.status !== "success" && !repo.expectsSuccess
          ? "OK (expected failure)"
          : "MISMATCH";
    console.log(
      `[seed-workflows] run #${run.id} → ${run.status} (exit ${run.exitCode ?? "—"}) in ${dur.toFixed(1)}s [${mark}]`,
    );
    if (repo.expectsSuccess && run.status === "success") {
      console.log(
        `[seed-workflows] live: ${OWNER_POD_ROOT}public/sites/${repo.name}/index.html`,
      );
    }
  }

  console.log(
    `\n[seed-workflows] done. open ${BRIDGE}/repos to see the dashboard.`,
  );
}

type RunSummary = {
  id: number;
  status: string;
  exitCode: number | null;
  startedAt: number;
  finishedAt: number | null;
};

async function ensureRepo(repo: Repo): Promise<void> {
  const existing = await fetch(`${BRIDGE}/api/repos/${OWNER}/${repo.name}`);
  if (existing.ok) {
    console.log(`[seed-workflows] repo exists, reusing`);
    return;
  }
  const res = await fetch(`${BRIDGE}/api/repos`, {
    method: "POST",
    headers: SEED_HEADERS,
    body: JSON.stringify({
      owner: OWNER,
      name: repo.name,
      ownerWebId: OWNER_WEBID,
      ownerPodRoot: OWNER_POD_ROOT,
      visibility: "public",
    }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`POST /api/repos: ${res.status} ${await res.text()}`);
  }
  console.log(`[seed-workflows] repo created`);
}

async function ensurePagesConfig(repo: Repo): Promise<void> {
  const target = `${OWNER_POD_ROOT}public/sites/${repo.name}/`;
  const res = await fetch(
    `${BRIDGE}/api/repos/${OWNER}/${repo.name}/pages`,
    {
      method: "PUT",
      headers: SEED_HEADERS,
      body: JSON.stringify({
        enabled: true,
        sourceBranch: "main",
        sourcePath: "/",
        targetContainer: target,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`PUT pages: ${res.status} ${await res.text()}`);
  }
}

async function mintToken(repo: Repo): Promise<string> {
  const res = await fetch(
    `${BRIDGE}/api/repos/${OWNER}/${repo.name}/tokens`,
    {
      method: "POST",
      headers: SEED_HEADERS,
      body: JSON.stringify({
        label: `seed-workflows ${new Date().toISOString()}`,
      }),
    },
  );
  if (!res.ok) throw new Error(`POST tokens: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function latestRunId(repo: Repo): Promise<number> {
  const res = await fetch(
    `${BRIDGE}/api/repos/${OWNER}/${repo.name}/runs?limit=1`,
  );
  if (!res.ok) return 0;
  const data = (await res.json()) as { runs: RunSummary[] };
  return data.runs[0]?.id ?? 0;
}

async function waitForNewRun(
  repo: Repo,
  lastSeenRunId: number,
): Promise<RunSummary | null> {
  const deadline = Date.now() + RUN_POLL_MAX_MS;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${BRIDGE}/api/repos/${OWNER}/${repo.name}/runs?limit=1`,
    );
    if (res.ok) {
      const data = (await res.json()) as { runs: RunSummary[] };
      const r = data.runs[0];
      if (
        r &&
        r.id > lastSeenRunId &&
        r.status !== "queued" &&
        r.status !== "running"
      ) {
        return r;
      }
    }
    await sleep(RUN_POLL_INTERVAL_MS);
  }
  return null;
}

async function pushSite(repo: Repo, token: string): Promise<void> {
  const dir = await mkdtemp(
    join(tmpdir(), `mind-codespaces-seed-wf-${repo.name}-`),
  );
  try {
    for (const [name, content] of Object.entries(repo.files)) {
      const filePath = join(dir, name);
      const parent = filePath.slice(0, filePath.lastIndexOf("/"));
      if (parent && parent !== dir) {
        await mkdir(parent, { recursive: true });
      }
      await writeFile(filePath, content, "utf-8");
    }
    await git(["init", "-b", "main"], dir);
    await git(["config", "user.email", "seed@mind-codespaces.local"], dir);
    await git(["config", "user.name", "seed-workflows"], dir);
    await git(["add", "."], dir);
    await git(["commit", "-m", "seed: workflow demo content"], dir);
    const remote = `http://seed:${token}@localhost:3010/api/git/${OWNER}/${repo.name}.git`;
    await git(["remote", "add", "origin", remote], dir);
    await git(["push", "-f", "origin", "main"], dir);
    console.log(`[seed-workflows] pushed`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function git(args: string[], cwd: string): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", rejectFn);
    child.on("close", (code) => {
      if (code === 0) resolveFn();
      else rejectFn(new Error(`git ${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("[seed-workflows] failed:", err);
  process.exit(1);
});
