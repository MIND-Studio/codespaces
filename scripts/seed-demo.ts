/**
 * Seed two demo repos against a running bridge + CSS instance and push
 * static-site content into each. Idempotent: re-running re-pushes
 * (force) so the published sites stay in sync with the seed source.
 *
 * Usage:
 *   docker compose up -d       # CSS on :3011
 *   npm run dev                 # bridge on :3010
 *   npm run seed:demo
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

// Dev-only auth bypass for state-changing API calls. The bridge accepts
// `X-Mind-Dev-WebId` as a session impersonation header when NODE_ENV is
// not "production" (gated in src/lib/auth/session.ts:requireSession).
const SEED_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "X-Mind-Dev-WebId": OWNER_WEBID,
};

type SeedIssue = {
  title: string;
  body: string;
  priority?: "low" | "normal" | "high";
  labels?: string[];
  closed?: boolean;
};

type Repo = {
  name: string;
  visibility: "public" | "private";
  files: Record<string, string>;
  issues?: SeedIssue[];
};

// ---------------------------------------------------------------------------
// Explainer site content for alice/about — a meta demonstration: the page
// that explains how Mind Codespaces works is itself published via Mind
// Codespaces. All four HTML files share a `nav` element and `style.css`.
// ---------------------------------------------------------------------------

const NAV = `<nav class="topnav">
    <a href="index.html">Overview</a>
    <a href="architecture.html">Architecture</a>
    <a href="lifecycle.html">A push, step by step</a>
    <a href="identity.html">Identity &amp; auth</a>
  </nav>`;

const FOOTER = `<footer>
    <hr>
    <p>
      Published from a <code>git push</code> to a local Mind Codespaces
      bridge at <code>http://localhost:3010</code>. This page lives on
      alice's Solid Pod at <code>/public/sites/about/</code>; the bridge
      can rebuild it but cannot take it away.
    </p>
  </footer>`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Mind Codespaces</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <p class="eyebrow">Mind Codespaces · about</p>
    <h1>${title}</h1>
  </header>
  ${NAV}
  <main>
${body}
  </main>
  ${FOOTER}
</body>
</html>
`;
}

const EXPLAINER_INDEX = page(
  "How this works, in five steps",
  `    <p class="lede">
      Mind Codespaces is a tiny bridge between Git and Solid Pods. You
      <code>git push</code> a static site to a configured branch, and the
      bridge publishes it into a pod URL you control. Identity, repository
      metadata, and the artifact all live on your pod — the bridge is just
      protocol glue.
    </p>

    <ol class="steps">
      <li>
        <h3>Point a git remote at the bridge.</h3>
        <p>
          After <code>POST /api/repos</code>, the bridge has a row in its
          SQLite registry and a bare repo on disk at
          <code>.git-data/repos/alice/about.git/</code>. The pod gains a
          Turtle description at
          <code>/codespaces/about/index.ttl</code>.
        </p>
      </li>
      <li>
        <h3>Mint a push token and run <code>git push</code>.</h3>
        <p>
          The bridge speaks the Git Smart HTTP protocol via
          <code>git http-backend</code>, gated by HTTP Basic against
          <code>sha256</code>-hashed tokens. Username is ignored; the token
          is the bearer.
        </p>
      </li>
      <li>
        <h3>A post-receive hook fires.</h3>
        <p>
          A shell hook installed at repo-creation time
          <code>curl</code>s back into the bridge with the updated ref.
          The bridge logs <code>repo.updated</code> and, if the ref matches
          the configured Mind Pages source branch, schedules the publisher.
        </p>
      </li>
      <li>
        <h3>The publisher uploads the branch to your pod.</h3>
        <p>
          It checks out the branch shallow into a temp directory, walks
          the configured source path (skipping <code>.git</code>,
          <code>.env</code>, <code>node_modules</code>), and
          <code>PUT</code>s each file to your pod with the right
          <code>Content-Type</code>. The <code>/public/</code> container's
          ACL is set <em>public-read</em> idempotently so anyone can
          fetch what you've published.
        </p>
      </li>
      <li>
        <h3>The site is reachable at a URL you own.</h3>
        <p>
          For this page, that's
          <code>http://localhost:3011/alice/public/sites/about/</code>.
          If you swap pod hosts, you take the URL space with you — the
          bridge doesn't own anything except a cached clone of the bare
          repo, which any other bridge could reconstruct from a fresh push.
        </p>
      </li>
    </ol>

    <h2>What's <em>not</em> happening</h2>
    <ul>
      <li>No SaaS in the data path. No analytics. No CDN. No GitHub.</li>
      <li>No build step. The publisher copies bytes; you build before you push.</li>
      <li>No central message store. The bridge writes to your pod and forgets.</li>
      <li>
        No platform-owned identity. Authentication is either a seeded
        dev account or a real Solid-OIDC delegation flow against your
        pod's own issuer.
      </li>
    </ul>

    <p class="related">
      Read on:
      <a href="architecture.html">architecture</a> ·
      <a href="lifecycle.html">a push, step by step</a> ·
      <a href="identity.html">identity &amp; auth</a>
    </p>
`,
);

const EXPLAINER_ARCH = page(
  "Architecture",
  `    <p class="lede">
      Three nouns: a <strong>git client</strong>, a <strong>bridge</strong>,
      and a <strong>pod</strong>. Three flows between them.
    </p>

    <pre class="diagram">
   ┌──────────────┐                                  ┌──────────────────┐
   │  git client  │                                  │   Solid Pod      │
   └──────┬───────┘                                  │   (CSS at :3011) │
          │                                          │  alice/          │
          │ Git Smart HTTP                           │   ├── /profile/  │
          │ (clone / fetch / push)                   │   ├── /codespaces│
          ▼                                          │   │     /…/      │
   ┌─────────────────────────────────────┐           │   │ (Turtle      │
   │  Mind Codespaces bridge (Next.js)   │           │   │  metadata)   │
   │  http://localhost:3010              │           │   └── /public/   │
   │                                     │           │       /sites/    │
   │  • Git Smart HTTP route             │  spawn    │         {repo}/  │
   │    → git http-backend (CGI) ────────┼──────────▶│         index.html
   │                                     │           │         style.css│
   │  • Registry (SQLite)                │           │         …        │
   │    repos · pages · tokens ·         │           │                  │
   │    identities · identity_storage    │           └──────────────────┘
   │                                     │                  ▲    ▲
   │  • Pages publisher                  │   authenticated  │    │  authenticated
   │    git checkout → walk → PUT  ──────┼──────────────────┘    │  PUT
   │                                     │                       │
   │  • Repo metadata writer ────────────┼───────────────────────┘
   │    (solidgit: Turtle)               │
   │                                     │
   │  • Dashboard + identity UI          │
   └─────────────────────────────────────┘
    </pre>

    <h2>What lives where</h2>
    <dl class="defs">
      <dt>The bare Git repository</dt>
      <dd>
        Lives on the bridge's disk at
        <code>.git-data/repos/{owner}/{repo}.git/</code>. Why disk? Git
        has its own consistency rules around packfiles, refs, locks, and
        gc — reimplementing that on top of a Solid pod would fight all of
        them. Keep Git as Git.
      </dd>

      <dt>The published site</dt>
      <dd>
        Lives in your pod at <code>/public/sites/{repo}/</code>. The bridge
        writes it; you own it. If the bridge dies, the site survives.
      </dd>

      <dt>Repository metadata</dt>
      <dd>
        Lives in your pod at <code>/codespaces/{repo}/index.ttl</code> as
        Linked Data using the <code>solidgit:</code> vocabulary. Other
        Solid-aware tools can discover the repository through your pod
        without going through the bridge.
      </dd>

      <dt>Bookkeeping</dt>
      <dd>
        Lives in the bridge's SQLite at <code>.registry-data/registry.db</code>:
        the mapping <code>owner/repo → disk path</code>, Mind Pages config,
        sha256-hashed push tokens, and OIDC sessions for delegated auth.
        Bookkeeping only; nothing irreplaceable.
      </dd>
    </dl>

    <h2>Three flows</h2>
    <ol class="steps">
      <li>
        <h3>Git Smart HTTP</h3>
        <p>
          A Next.js Route Handler spawns the system
          <code>git http-backend</code> as a CGI, streams the request body
          into its stdin, parses CGI-style headers from stdout, and
          streams the rest back. Push always requires a token; clone
          requires a token when the repo is private.
        </p>
      </li>
      <li>
        <h3>Pages publish</h3>
        <p>
          On post-receive, the publisher clones the bare repo
          single-branch/depth-1 into a temp directory, walks the source
          path, and PUTs each file to the target container under your
          pod with the right MIME type.
        </p>
      </li>
      <li>
        <h3>Metadata write</h3>
        <p>
          On every repo or Pages-config change, the bridge rewrites the
          repository's Turtle description on your pod. Best-effort: a
          pod that's temporarily unreachable won't fail your API call.
        </p>
      </li>
    </ol>
`,
);

const EXPLAINER_LIFECYCLE = page(
  "A push, step by step",
  `    <p class="lede">
      The same push you'd make to GitHub, observed from inside the bridge.
      Each numbered step shows what the dev-server log actually prints.
    </p>

    <ol class="steps">
      <li>
        <h3>You run <code>git push</code>.</h3>
        <pre class="codeblock">$ git push http://me:scp_…@localhost:3010/api/git/alice/about.git main</pre>
        <p>
          Git makes a first request to <code>/info/refs?service=git-receive-pack</code>.
          The bridge classifies this as a push intent and gates on a valid
          token. If you forgot, you'd see:
        </p>
        <pre class="codeblock"> GET /api/git/alice/about.git/info/refs?service=git-receive-pack 401</pre>
      </li>

      <li>
        <h3>The CGI handles the protocol details.</h3>
        <p>
          With the token verified, the request is forwarded to
          <code>git http-backend</code>. The bridge's responsibility ends
          at piping bytes around — Git's own binary speaks every nuance
          of the Smart HTTP protocol.
        </p>
        <pre class="codeblock"> POST /api/git/alice/about.git/git-receive-pack 200 in 165ms</pre>
      </li>

      <li>
        <h3>The post-receive hook fires.</h3>
        <p>
          A shell script installed when the repo was created reads each
          updated ref line on stdin and curls the bridge's internal
          callback endpoint. The bridge logs the event:
        </p>
        <pre class="codeblock">[repo.updated] alice/about ref=refs/heads/main new=b6f3890e</pre>
      </li>

      <li>
        <h3>If the ref matches the Pages source branch, the publisher runs.</h3>
        <pre class="codeblock">[publisher] alice/about@main → http://localhost:3011/alice/public/sites/about/
[publisher] auth mode: delegated</pre>
        <p>
          <em>delegated</em> means the bridge is using a Solid-OIDC refresh
          token you previously granted via <code>/connect</code>;
          <em>seeded</em> means it's falling back to the dev-only shared
          credential. (See <a href="identity.html">Identity &amp; auth</a>.)
        </p>
      </li>

      <li>
        <h3>The publisher walks the checkout.</h3>
        <p>
          Files like <code>.git/</code>, <code>.env*</code>,
          <code>node_modules/</code>, and <code>.DS_Store</code> are
          filtered out <em>before</em> any PUT, so you can't accidentally
          publish secrets. For each survivor it computes the target URL,
          looks up the MIME type by extension, and:
        </p>
        <pre class="codeblock">PUT http://localhost:3011/alice/public/sites/about/index.html
PUT http://localhost:3011/alice/public/sites/about/style.css
PUT http://localhost:3011/alice/public/sites/about/architecture.html
…</pre>
      </li>

      <li>
        <h3>The ACL on <code>/public/</code> is re-asserted.</h3>
        <p>
          Idempotent re-PUT of a Turtle ACL granting owner Read/Write/Control
          and <code>foaf:Agent</code> (anyone) Read. The
          <code>acl:default</code> predicate means children inherit. If
          external tooling ever narrows it, the next publish corrects course.
        </p>
      </li>

      <li>
        <h3>Done.</h3>
        <pre class="codeblock">[publisher] alice/about → http://localhost:3011/alice/public/sites/about/ done. uploaded=5 skipped=0</pre>
        <p>
          The bridge updates <code>last_published_at</code> in SQLite and
          returns. From your machine's perspective, the
          <code>git push</code> finished a second ago; the site is now
          live at a URL on your pod.
        </p>
      </li>
    </ol>
`,
);

const EXPLAINER_IDENTITY = page(
  "Identity &amp; auth",
  `    <p class="lede">
      Two surfaces: <strong>who can push or clone</strong> (push tokens),
      and <strong>who the publisher acts as</strong> (seeded or delegated).
    </p>

    <h2>Push tokens — gating Git operations</h2>
    <p>
      Every <code>git push</code> requires an HTTP-Basic token. Public
      clones don't; private clones do. Tokens are minted from the repo
      detail page or with <code>POST /api/repos/{o}/{r}/tokens</code>;
      the plaintext is shown once and stored as a <code>sha256</code> hash.
      Revoke from the same page or
      <code>DELETE /api/repos/{o}/{r}/tokens/{id}</code>.
    </p>
    <pre class="codeblock">curl -X POST http://localhost:3010/api/repos/alice/about/tokens \\
  -H 'Content-Type: application/json' -d '{"label":"my laptop"}'
# → { "token": "scp_…", "id": 7 }

git push http://me:scp_…@localhost:3010/api/git/alice/about.git main</pre>

    <h2>Auth modes for the publisher</h2>
    <p>
      The publisher needs to <code>PUT</code> files into the owner's pod.
      It looks up an authenticated <code>fetch</code> for the owner's WebID
      and prefers the most-privileged option available.
    </p>

    <h3>Seeded (the demo fallback)</h3>
    <p>
      The bridge holds a shared CSS account credential in env vars
      (<code>POD_USER_EMAIL</code> / <code>POD_USER_PASSWORD</code>). Fine
      for a single-user local demo; not fine for a real product. The
      bridge knows your password.
    </p>

    <h3>Delegated (the real flow)</h3>
    <p>
      Visit <code>/connect</code> on the bridge and authorize. The bridge
      runs a full Solid-OIDC authorization-code flow against your pod's
      OIDC issuer, dynamically registering itself as a client called
      "Mind Codespaces". You see a real consent screen on your pod's own
      login surface. The bridge stores the refresh token (alongside DPoP
      keys and PKCE state) in its SQLite, indexed by your WebID.
    </p>
    <p>
      From then on, when the publisher acts on behalf of your WebID it
      uses a fresh access token minted from that refresh token. Disconnect
      from <code>/identities</code> to drop the mapping; subsequent
      publishes fall back to seeded mode.
    </p>

    <h2>What the bridge does <em>not</em> hold</h2>
    <ul>
      <li>Your pod password (in delegated mode).</li>
      <li>Any data about who clones your public repos.</li>
      <li>A copy of the published site &mdash; that lives on your pod, not on the bridge.</li>
      <li>Your repository's history outside of the bare git data dir, which is throwaway: another bridge could reconstruct it from a single <code>git push</code>.</li>
    </ul>
`,
);

const EXPLAINER_CSS = `:root {
  --paper: #fbfaf6;
  --paper-soft: #f4f1eb;
  --paper-sunk: #e9e4d9;
  --ink: #1f1d1a;
  --ink-soft: #524d45;
  --ink-faint: #8a8378;
  --ink-trace: #d7d1c4;
  --accent: #c4801d;
  --accent-deep: #8a570f;
  color-scheme: light;
}

/* Static site, no JS — follow the OS preference. */
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #16191a;
    --paper-soft: #1c2120;
    --paper-sunk: #232a28;
    --ink: #ecead8;
    --ink-soft: #b6b1a0;
    --ink-faint: #7c7868;
    --ink-trace: #383d39;
    --accent: #e5a44a;
    --accent-deep: #f3c172;
    color-scheme: dark;
  }
}

* { box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  max-width: 42rem;
  margin: 3rem auto 6rem auto;
  padding: 0 1.25rem;
  color: var(--ink);
  background: var(--paper);
  line-height: 1.6;
}

header {
  margin-bottom: 1.5rem;
}

.eyebrow {
  margin: 0 0 0.5rem 0;
  font-size: 0.72rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink-faint);
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace;
}

h1 {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: clamp(2rem, 4.5vw, 2.6rem);
  letter-spacing: -0.02em;
  line-height: 1.1;
  margin: 0;
}

h2 {
  font-family: Georgia, serif;
  font-size: 1.4rem;
  letter-spacing: -0.01em;
  margin-top: 3rem;
}

h3 {
  font-family: Georgia, serif;
  font-size: 1.05rem;
  margin: 0.5rem 0 0.4rem 0;
}

.topnav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 1.1rem;
  margin: 1.5rem 0 2.5rem 0;
  padding: 0.6rem 0;
  border-top: 1px solid var(--ink-trace);
  border-bottom: 1px solid var(--ink-trace);
  font-family: 'JetBrains Mono', Menlo, monospace;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.topnav a {
  color: var(--ink-soft);
  text-decoration: none;
}

.topnav a:hover {
  color: var(--accent);
}

p, li {
  font-size: 1rem;
}

.lede {
  font-size: 1.12rem;
  color: var(--ink-soft);
  margin: 0 0 2rem 0;
}

a {
  color: var(--accent-deep);
  text-decoration: underline;
  text-decoration-color: var(--ink-trace);
  text-underline-offset: 3px;
  transition: color 120ms, text-decoration-color 120ms;
}

a:hover {
  color: var(--accent);
  text-decoration-color: var(--accent);
}

code {
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 0.88em;
  background: var(--paper-soft);
  padding: 0.1rem 0.35rem;
  border-radius: 3px;
  border: 1px solid var(--ink-trace);
}

pre {
  margin: 1rem 0 1.4rem 0;
  padding: 0.9rem 1.1rem;
  background: var(--paper-sunk);
  border: 1px solid var(--ink-trace);
  border-radius: 4px;
  font-family: 'JetBrains Mono', Menlo, Consolas, monospace;
  font-size: 0.8rem;
  line-height: 1.55;
  overflow-x: auto;
  white-space: pre;
}

pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: inherit;
}

.diagram {
  font-size: 0.72rem;
  line-height: 1.35;
}

ol.steps {
  list-style: none;
  counter-reset: step;
  padding: 0;
  margin: 1.5rem 0;
}

ol.steps > li {
  counter-increment: step;
  position: relative;
  padding: 0 0 1.4rem 2.6rem;
  margin-bottom: 1.4rem;
  border-bottom: 1px solid var(--ink-trace);
}

ol.steps > li:last-child {
  border-bottom: none;
  padding-bottom: 0;
  margin-bottom: 0;
}

ol.steps > li::before {
  content: counter(step, decimal-leading-zero);
  position: absolute;
  left: 0;
  top: 0.15rem;
  font-family: 'JetBrains Mono', Menlo, monospace;
  font-size: 0.78rem;
  color: var(--accent);
  letter-spacing: 0.05em;
}

dl.defs {
  margin: 1.5rem 0;
}

dl.defs dt {
  font-family: Georgia, serif;
  font-style: italic;
  font-size: 1.05rem;
  margin-top: 1.2rem;
  color: var(--ink);
}

dl.defs dt:first-child {
  margin-top: 0;
}

dl.defs dd {
  margin: 0.3rem 0 0 0;
  color: var(--ink-soft);
}

ul {
  padding-left: 1.2rem;
}

ul li {
  margin-bottom: 0.45rem;
}

.related {
  margin-top: 2.5rem;
  font-family: 'JetBrains Mono', Menlo, monospace;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--ink-faint);
}

footer {
  margin-top: 4rem;
  font-size: 0.85rem;
  color: var(--ink-faint);
}

footer hr {
  border: 0;
  border-top: 1px solid var(--ink-trace);
  margin: 0 0 1.2rem 0;
}
`;
const BUILT_SITE_CONTENT = `# Built from a workflow

This page didn't exist as HTML when it was pushed.

The repo's source is **one markdown file** + a Node script. On every push:

1. The bridge clones the branch to a temp directory.
2. It finds \`.mind/workflow.yml\` and runs the listed commands —
   here, just \`node scripts/build.mjs\`.
3. The build script reads \`content.md\` and writes \`dist/index.html\`.
4. The bridge takes everything in \`dist/\` and uploads it to the
   configured Mind Pages target on alice's pod.

No Docker, no WASM, no CI service. Just \`sh -c\` on the bridge host.

* This file proves the workflow ran.
* The dashboard's "Latest build" panel shows the log.
* The pod URL serving this HTML is the only thing the public sees.
`;

const BUILT_SITE_BUILD = `#!/usr/bin/env node
// Tiny Node-only build: content.md → dist/index.html.
// No external deps — runs the same way on any machine with Node ≥18.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const md = readFileSync("content.md", "utf-8");

// Very small markdown subset: headings, bold/italic, lists, paragraphs.
// Enough to make the demo readable; not a Markdown renderer.
function escape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s) {
  return escape(s)
    .replace(/\`([^\`]+)\`/g, "<code>$1</code>")
    .replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>")
    .replace(/\\*([^*]+)\\*/g, "<em>$1</em>");
}

const lines = md.split("\\n");
let html = "";
let inList = false;
for (const raw of lines) {
  const line = raw.trimEnd();
  if (!line) {
    if (inList) { html += "</ul>\\n"; inList = false; }
    continue;
  }
  let m;
  if ((m = /^# (.+)$/.exec(line))) {
    if (inList) { html += "</ul>\\n"; inList = false; }
    html += \`<h1>\${inline(m[1])}</h1>\\n\`;
  } else if ((m = /^## (.+)$/.exec(line))) {
    if (inList) { html += "</ul>\\n"; inList = false; }
    html += \`<h2>\${inline(m[1])}</h2>\\n\`;
  } else if ((m = /^\\d+\\. (.+)$/.exec(line))) {
    if (!inList) { html += "<ol>\\n"; inList = "ol"; }
    html += \`  <li>\${inline(m[1])}</li>\\n\`;
  } else if ((m = /^[*-] (.+)$/.exec(line))) {
    if (!inList) { html += "<ul>\\n"; inList = "ul"; }
    html += \`  <li>\${inline(m[1])}</li>\\n\`;
  } else {
    if (inList) { html += (inList === "ol" ? "</ol>\\n" : "</ul>\\n"); inList = false; }
    html += \`<p>\${inline(line)}</p>\\n\`;
  }
}
if (inList) html += (inList === "ol" ? "</ol>\\n" : "</ul>\\n");

const page = \`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Built from a workflow</title>
  <style>
    :root { --ink: #1f1d1a; --paper: #fbfaf6; --paper-soft: #f4f1eb; --ink-trace: #d7d1c4; --accent: #c4801d; }
    @media (prefers-color-scheme: dark) {
      :root { --ink: #ecead8; --paper: #16191a; --paper-soft: #1c2120; --ink-trace: #383d39; --accent: #e5a44a; }
    }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 38rem; margin: 3rem auto; padding: 0 1.25rem; color: var(--ink); background: var(--paper); line-height: 1.6; }
    h1 { font-family: Georgia, serif; font-size: 2rem; letter-spacing: -0.015em; }
    h2 { font-family: Georgia, serif; font-size: 1.25rem; margin-top: 2rem; }
    code { font-family: Menlo, Consolas, monospace; font-size: 0.88em; background: var(--paper-soft); border: 1px solid var(--ink-trace); padding: 0.08rem 0.32rem; border-radius: 3px; }
    ul, ol { padding-left: 1.4rem; }
    li { margin: 0.25rem 0; }
    strong { font-weight: 600; }
    em { font-style: italic; }
    footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--ink-trace); font-size: 0.85rem; color: var(--accent); }
  </style>
</head>
<body>
\${html}
<footer>Generated \${new Date().toISOString()} by <code>node scripts/build.mjs</code></footer>
</body>
</html>
\`;

mkdirSync("dist", { recursive: true });
writeFileSync("dist/index.html", page, "utf-8");
console.log("wrote dist/index.html (" + page.length + " bytes)");
`;

const BUILT_SITE_WORKFLOW = `run:
  - node scripts/build.mjs
publish: dist
`;

const REPOS: Repo[] = [
  {
    name: "bakery",
    visibility: "public",
    issues: [
      {
        title: "Add a weekly bread schedule page",
        body: "Customers keep asking which loaves run on which days. A static `schedule.html` linked from the index would cover it. Mon–Fri rotation, Saturday brioche, Sunday closed.",
        priority: "normal",
        labels: ["enhancement", "good-first-issue"],
      },
      {
        title: "Price list out of date — walnut bread is €4.80, not €4.50",
        body: "Index page still lists €4.50 for the Walnussbrot. Should be €4.80 (raised last quarter).",
        priority: "high",
        labels: ["bug"],
      },
      {
        title: "Mobile layout: nav wraps awkwardly under 360px",
        body: "On narrow phones the `topnav` items fall onto three lines and the eyebrow text overlaps the heading. Worth a `@media` tweak.",
        priority: "low",
        labels: ["ui", "css"],
      },
    ],
    files: {
      "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Bäckerei Heusser — open today</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <h1>Bäckerei <em>Heusser</em></h1>
    <p>Open today 6:00–18:00 · Hauptstrasse 12, Zweibrücken</p>
  </header>
  <main>
    <section>
      <h2>This week's bread</h2>
      <ul>
        <li>Roggenmischbrot · €3.20</li>
        <li>Sauerteig-Vollkorn · €4.10</li>
        <li>Walnussbrot · €4.80</li>
        <li>Brioche (Saturdays only) · €5.50</li>
      </ul>
    </section>
    <section>
      <p>
        Visit our <a href="hours.html">opening hours</a> for the rest of the week.
      </p>
    </section>
  </main>
  <footer>
    <p>This page lives on our own Solid Pod and was published from a <code>git push</code>.</p>
  </footer>
</body>
</html>
`,
      "hours.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hours · Bäckerei Heusser</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <p><a href="index.html">← back home</a></p>
  <h1>Opening hours</h1>
  <table>
    <tr><th>Mon–Fri</th><td>6:00–18:00</td></tr>
    <tr><th>Saturday</th><td>6:00–14:00</td></tr>
    <tr><th>Sunday</th><td>closed</td></tr>
  </table>
</body>
</html>
`,
      "style.css": `* { box-sizing: border-box; }
body {
  font-family: Georgia, 'Times New Roman', serif;
  max-width: 36rem;
  margin: 4rem auto;
  padding: 0 1rem;
  color: #1f1d1a;
  background: #fbfaf6;
  line-height: 1.55;
}
h1 { font-size: 2.4rem; letter-spacing: -0.01em; margin-bottom: 0.2rem; }
h1 em { color: #c4801d; }
h2 { font-size: 1.2rem; margin-top: 2.4rem; }
ul { padding-left: 1.2rem; }
li { margin-bottom: 0.4rem; }
table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
th, td { text-align: left; padding: 0.45rem 0.6rem; border-bottom: 1px solid #d7d1c4; }
footer { margin-top: 3rem; font-size: 0.85rem; color: #8a8378; }
a { color: #c4801d; }
`,
    },
  },
  {
    name: "notes",
    visibility: "public",
    issues: [
      {
        title: "Add an RSS feed",
        body: "Notes is approaching a state where someone might want to subscribe. A simple `feed.xml` generated from the article list would do. Either a build-time script or a static hand-written file would be acceptable.",
        priority: "normal",
        labels: ["enhancement", "ready"],
      },
      {
        title: "Backfill dates on pre-2026 entries",
        body: "The two seeded articles have dates in the headings but no machine-readable `<time datetime>` element. Add those so search engines and feed readers can parse them.",
        priority: "low",
        labels: ["docs"],
        closed: true,
      },
    ],
    files: {
      "index.html": `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>alice · notes</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>alice's <em>notes</em></h1>
  <p>A pod-hosted notebook. Each push is a new edit.</p>
  <article>
    <h2>2026-05-21 · On owning your own publishing surface</h2>
    <p>
      I moved my website from a SaaS host to my Solid Pod today. The
      mechanics are: I push a git branch; a tiny bridge writes the files
      into <code>/public/sites/notes/</code> on my pod; that container is
      world-readable, so anyone with the URL can read it. If I switch pod
      providers tomorrow, the URL changes but my data, my history, my
      identity all come with me.
    </p>
  </article>
  <article>
    <h2>2026-05-19 · Cash markets and code repos, same idea</h2>
    <p>
      The Mind Market prototype proved a marketplace can live on user-owned
      pods. The Mind Codespaces prototype I'm reading from now extends the
      same idea to a developer surface: the artifact lives on your pod,
      the platform is a thin translator.
    </p>
  </article>
</body>
</html>
`,
      "style.css": `body {
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  max-width: 38rem;
  margin: 3rem auto;
  padding: 0 1rem;
  color: #1f1d1a;
  background: #fbfaf6;
  line-height: 1.6;
}
h1 { font-family: Georgia, serif; font-size: 2.2rem; letter-spacing: -0.015em; }
h1 em { color: #c4801d; }
article { margin-top: 2.5rem; padding-top: 1.5rem; border-top: 1px solid #d7d1c4; }
article h2 { font-size: 1.1rem; margin-bottom: 0.6rem; }
code { background: #f4f1eb; padding: 0.1rem 0.35rem; border-radius: 3px; font-size: 0.92em; }
`,
    },
  },
  {
    name: "about",
    visibility: "public",
    files: {
      "index.html": EXPLAINER_INDEX,
      "architecture.html": EXPLAINER_ARCH,
      "lifecycle.html": EXPLAINER_LIFECYCLE,
      "identity.html": EXPLAINER_IDENTITY,
      "style.css": EXPLAINER_CSS,
    },
  },
  {
    // Workflow demo: source is markdown + a Node-only build script.
    // .mind/workflow.yml runs `node scripts/build.mjs` which renders
    // content.md → dist/index.html (no external deps). The runner
    // publishes `dist/` to Mind Pages via the existing publisher.
    name: "built-site",
    visibility: "public",
    files: {
      "content.md": BUILT_SITE_CONTENT,
      "scripts/build.mjs": BUILT_SITE_BUILD,
      ".mind/workflow.yml": BUILT_SITE_WORKFLOW,
      "README.md":
        "# built-site\n\nDemo for Mind Codespaces **workflows**.\n\nPush triggers `.mind/workflow.yml`, which runs `node scripts/build.mjs` to render `content.md` into `dist/index.html`, then the bridge publishes `dist/` to Mind Pages.\n",
    },
  },
];

async function main() {
  console.log(`[seed] bridge=${BRIDGE}`);
  console.log(`[seed] pod=${OWNER_POD_ROOT}`);

  for (const repo of REPOS) {
    console.log(`\n[seed] === ${OWNER}/${repo.name} ===`);
    await ensureRepo(repo);
    await ensurePagesConfig(repo);
    const token = await mintToken(repo);
    await pushSite(repo, token);
    const publishedUrl = `${OWNER_POD_ROOT}public/sites/${repo.name}/index.html`;
    console.log(`[seed] published: ${publishedUrl}`);
    if (repo.issues && repo.issues.length > 0) {
      await ensureIssues(repo);
    }
  }

  console.log("\n[seed] done. open http://localhost:3010/repos to see the dashboard.");
}

async function ensureIssues(repo: Repo): Promise<void> {
  // Skip if the repo already has issues (idempotent reseed).
  const existing = await fetch(
    `${BRIDGE}/api/repos/${OWNER}/${repo.name}/issues?status=all`,
  );
  if (existing.ok) {
    const data = (await existing.json()) as { issues: { id: number }[] };
    if (data.issues.length > 0) {
      console.log(`[seed] issues exist (${data.issues.length}), skipping`);
      return;
    }
  }
  for (const issue of repo.issues!) {
    const res = await fetch(
      `${BRIDGE}/api/repos/${OWNER}/${repo.name}/issues`,
      {
        method: "POST",
        headers: SEED_HEADERS,
        body: JSON.stringify({
          title: issue.title,
          body: issue.body,
          priority: issue.priority,
          labels: issue.labels,
        }),
      },
    );
    if (!res.ok) {
      console.warn(
        `[seed] failed to file issue ${JSON.stringify(issue.title)}: ${res.status}`,
      );
      continue;
    }
    const data = (await res.json()) as { issue: { number: number } };
    if (issue.closed) {
      await fetch(
        `${BRIDGE}/api/repos/${OWNER}/${repo.name}/issues/${data.issue.number}`,
        {
          method: "PATCH",
          headers: SEED_HEADERS,
          body: JSON.stringify({ status: "closed" }),
        },
      );
    }
    console.log(
      `[seed] issue #${data.issue.number}${issue.closed ? " (closed)" : ""}: ${issue.title}`,
    );
  }
}

async function ensureRepo(repo: Repo): Promise<void> {
  // Try GET first — idempotent.
  const existing = await fetch(`${BRIDGE}/api/repos/${OWNER}/${repo.name}`);
  if (existing.ok) {
    console.log(`[seed] repo exists, reusing`);
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
      visibility: repo.visibility,
    }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`POST /api/repos: ${res.status} ${await res.text()}`);
  }
  console.log(`[seed] repo created`);
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
  console.log(`[seed] pages → ${target}`);
}

async function mintToken(repo: Repo): Promise<string> {
  const res = await fetch(
    `${BRIDGE}/api/repos/${OWNER}/${repo.name}/tokens`,
    {
      method: "POST",
      headers: SEED_HEADERS,
      body: JSON.stringify({ label: `seed-demo ${new Date().toISOString()}` }),
    },
  );
  if (!res.ok) throw new Error(`POST tokens: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function pushSite(repo: Repo, token: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), `mind-codespaces-seed-${repo.name}-`));
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
    await git(["config", "user.name", "seed-demo"], dir);
    await git(["add", "."], dir);
    await git(["commit", "-m", "seed: initial demo content"], dir);
    const remote = `http://seed:${token}@localhost:3010/api/git/${OWNER}/${repo.name}.git`;
    await git(["remote", "add", "origin", remote], dir);
    // Force-push so reseed always overwrites.
    await git(["push", "-f", "origin", "main"], dir);
    console.log(`[seed] pushed`);
    // Give the publisher a beat to upload.
    await new Promise((r) => setTimeout(r, 3000));
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
      else reject(new Error(`git ${args.join(" ")} exited ${code}: ${stderr}`));
    });
  });
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});

