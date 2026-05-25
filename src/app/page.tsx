import Link from "next/link";
import { listRepos, getRepoById, getPagesConfig } from "@/lib/registry/repos";
import {
  countAllRuns,
  getLatestRunOverall,
  listRunsForRepo,
  type WorkflowRun,
} from "@/lib/registry/runs";
import { RelativeTime } from "@/components/relative-time";
import { CopyButton } from "@/components/copy-button";

export const dynamic = "force-dynamic";

const POD_BASE = "http://localhost:3011/";
const BRIDGE_BASE = "http://localhost:3010";

type DemoConfig = {
  owner: string;
  name: string;
  blurb: string;
  /** Optional path *after* /repos/{owner}/{name}/ to deep-link a specific page. */
  detailPath?: string;
  /** What to label the detail-page link. Defaults to "build log". */
  detailLabel?: string;
};

/**
 * Hand-picked demos to surface from seed:demo + seed:workflows. Each
 * entry is rendered only if the corresponding repo actually exists in
 * the registry — fresh installs see an empty demo list and the
 * quickstart instead.
 */
const DEMOS: DemoConfig[] = [
  {
    owner: "alice",
    name: "marked-blog",
    blurb:
      "A multi-page blog rendered from markdown by a workflow. Real npm install inside the runner container.",
  },
  {
    owner: "alice",
    name: "tailwind-site",
    blurb:
      "Real Tailwind v4 CLI pipeline — four shell steps inside one container.",
  },
  {
    owner: "alice",
    name: "about",
    blurb:
      "The explainer site, published through this bridge itself. Four interlinked pages, no workflow.",
  },
  {
    owner: "alice",
    name: "broken-build",
    blurb:
      "A workflow that deliberately fails at step 3 of 4 so the failure UI is visible.",
    detailPath: "runs",
    detailLabel: "failure log",
  },
];

export default function LandingPage() {
  const repos = listRepos();
  const runCount = countAllRuns();
  const latestRun = getLatestRunOverall();
  const latestRunRepo = latestRun ? getRepoById(latestRun.repoId) : null;
  const seeded = repos.length > 0;

  // Recent-runs sparkline: merge the last 20 from every repo, re-sort,
  // take the most recent 24. Avoids touching src/lib to add a new query.
  const recentRuns: WorkflowRun[] = repos
    .flatMap((r) => listRunsForRepo(r.id, 20))
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-24);

  const livingDemos = DEMOS.flatMap((demo) => {
    const repo = repos.find(
      (r) => r.owner === demo.owner && r.name === demo.name,
    );
    if (!repo) return [];
    const pages = getPagesConfig(repo.id);
    const live =
      pages?.enabled && pages.targetContainer
        ? `${pages.targetContainer}${pages.targetContainer.endsWith("/") ? "" : "/"}index.html`
        : null;
    return [{ demo, live }];
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-10 sm:py-16">
      <p className="section-mark">Prototype · v0</p>
      <h1
        className="display mt-4 text-4xl sm:text-5xl md:text-6xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Your <em>pod</em> is your platform.
      </h1>
      <p
        className="mt-4 text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        Your code · <span style={{ color: "var(--accent)" }}>your context</span> · your pod.
      </p>
      <p className="mt-6 text-lg leading-relaxed text-[color:var(--ink-soft)]">
        Mind Codespaces is an AI-native Git platform built around your own
        Solid Pod. You <span className="kbd">git push</span> code, file
        issues, and let an agent draft pull requests — and the artifacts,
        history, and AI memory stay under <em>your</em> WebID, in{" "}
        <em>your</em> pod. The bridge translates protocols; it doesn&apos;t
        own your project.
      </p>

      <FlowDiagram />

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href="/repos"
          className="inline-block rounded border border-[color:var(--accent)] bg-transparent px-4 py-2 text-sm text-[color:var(--accent)] transition-colors hover:bg-[color:var(--accent)] hover:text-[color:var(--paper)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Open the dashboard →
        </Link>
        {livingDemos[0] ? (
          <Link
            href={`/repos/${livingDemos[0].demo.owner}/${livingDemos[0].demo.name}`}
            className="inline-block rounded border border-[color:var(--ink-trace)] px-4 py-2 text-sm transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            See a live demo →
          </Link>
        ) : null}
      </div>

      <hr className="hairline my-12" />

      <Section title="Live in this bridge">
        <div className="grid grid-cols-3 gap-3 sm:gap-8">
          <Stat label="repos" value={repos.length.toString()} />
          <Stat label="runs" value={runCount.toString()} />
          <Stat
            label="last activity"
            value={latestRun ? <RelativeTime ts={latestRun.startedAt} /> : "—"}
          />
        </div>
        {recentRuns.length > 0 ? (
          <RunSparkline runs={recentRuns} />
        ) : null}
        {latestRun && latestRunRepo ? (
          <p className="mt-4 text-sm text-[color:var(--ink-soft)]">
            Latest:{" "}
            <Link
              href={`/repos/${latestRunRepo.owner}/${latestRunRepo.name}/runs/${latestRun.id}`}
              className="link"
            >
              {latestRunRepo.owner}/{latestRunRepo.name} run #{latestRun.id}
            </Link>{" "}
            <RunStatusInline status={latestRun.status} />
          </p>
        ) : null}
      </Section>

      {livingDemos.length > 0 ? (
        <>
          <hr className="hairline my-12" />
          <Section title="Try these now">
            <p className="mb-5 text-sm text-[color:var(--ink-soft)]">
              Seeded demos pushed to alice&apos;s pod. Click into the repo to
              browse code + runs; the live link opens the page that was
              actually published.
            </p>
            <ul className="space-y-3">
              {livingDemos.map(({ demo, live }, i) => (
                <DemoCard
                  key={`${demo.owner}/${demo.name}`}
                  demo={demo}
                  live={live}
                  featured={i === 0}
                />
              ))}
            </ul>
          </Section>
        </>
      ) : null}

      <hr className="hairline my-12" />

      <Section title={seeded ? "API quickstart" : "Get started"}>
        <p className="mb-4 text-sm text-[color:var(--ink-soft)]">
          {seeded ? (
            <>
              The dashboard does this for you, but the curl flow below is
              the entire path from <span className="kbd">curl</span> to a
              site living in alice&apos;s pod. Useful if you want to script
              repo creation from another tool.
            </>
          ) : (
            <>
              No repos registered yet. Run{" "}
              <code className="kbd">npm run seed:demo</code> and{" "}
              <code className="kbd">npm run seed:workflows</code> to populate
              the bridge with worked examples, or follow the steps below.
            </>
          )}
        </p>

        <details
          className="rounded border border-[color:var(--ink-trace)] overflow-hidden"
          open={!seeded}
        >
          <summary
            className="cursor-pointer px-4 py-2 bg-[color:var(--paper-soft)] border-b border-[color:var(--ink-trace)] text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Four shell steps
          </summary>
          <div className="space-y-6 p-5 bg-[color:var(--paper)]">
            <QuickstartStep
              number="01"
              title="Create a repo"
              body={`curl -X POST ${BRIDGE_BASE}/api/repos \\
  -H 'Content-Type: application/json' \\
  -d '{
    "owner": "alice",
    "name": "hello",
    "ownerWebId": "${POD_BASE}alice/profile/card#me",
    "ownerPodRoot": "${POD_BASE}alice/",
    "visibility": "public"
  }'`}
            />
            <QuickstartStep
              number="02"
              title="Configure Mind Pages"
              body={`curl -X PUT ${BRIDGE_BASE}/api/repos/alice/hello/pages \\
  -H 'Content-Type: application/json' \\
  -d '{
    "enabled": true,
    "sourceBranch": "main",
    "sourcePath": "/",
    "targetContainer": "${POD_BASE}alice/public/sites/hello/"
  }'`}
            />
            <QuickstartStep
              number="03"
              title="Mint a push token"
              body={`TOKEN=$(curl -fsS -X POST ${BRIDGE_BASE}/api/repos/alice/hello/tokens \\
  -H 'Content-Type: application/json' \\
  -d '{"label":"my laptop"}' \\
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')`}
            />
            <QuickstartStep
              number="04"
              title="Push a site"
              body={`mkdir /tmp/hello && cd /tmp/hello
echo '<!doctype html><h1>Hello from Mind Pages</h1>' > index.html
git init -b main && git add . && git commit -m init
git push "${BRIDGE_BASE.replace("http://", "http://me:${TOKEN}@")}/api/git/alice/hello.git" main`}
            />
          </div>
        </details>
      </Section>

      <p className="mt-12 text-sm leading-relaxed text-[color:var(--ink-soft)]">
        Read the{" "}
        <Link href="/docs/PRD.md" className="link">
          full PRD
        </Link>{" "}
        or the{" "}
        <a
          href="https://github.com/CommunitySolidServer/CommunitySolidServer"
          className="link"
          target="_blank"
          rel="noreferrer"
        >
          CommunitySolidServer docs
        </a>{" "}
        to understand the Solid side.
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2
        className="display text-2xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p
        className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {label}
      </p>
      <p
        className="mt-1 display break-words text-xl sm:text-2xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </p>
    </div>
  );
}

function RunStatusInline({ status }: { status: string }) {
  const tone =
    status === "success"
      ? "ok"
      : status === "running" || status === "queued"
        ? undefined
        : "bad";
  return (
    <span className="stamp ml-1" data-tone={tone}>
      {status}
    </span>
  );
}

/**
 * Small horizontal strip of dots — one per recent run, oldest left,
 * newest right. Colour-coded by status; tooltip carries repo + outcome.
 */
function RunSparkline({ runs }: { runs: WorkflowRun[] }) {
  const newest = runs[runs.length - 1];
  return (
    <div className="mt-5 flex items-center gap-3">
      <span
        className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        last {runs.length}
      </span>
      <div className="flex flex-1 items-center gap-[5px]">
        {runs.map((r) => {
          const color =
            r.status === "success"
              ? "var(--status-ok)"
              : r.status === "failed" || r.status === "error"
                ? "var(--status-bad)"
                : r.status === "running" || r.status === "queued"
                  ? "var(--accent)"
                  : "var(--ink-faint)";
          const isNewest = r.id === newest.id;
          return (
            <span
              key={r.id}
              title={`run #${r.id} · ${r.status}`}
              className="inline-block rounded-full"
              style={{
                width: isNewest ? 9 : 7,
                height: isNewest ? 9 : 7,
                background: color,
                opacity: r.status === "success" ? 1 : 0.9,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Tiny ascii-flavoured diagram showing the pipeline. Mono, dim, no
 * decoration — sets the tone without competing with the hero.
 */
function FlowDiagram() {
  return (
    <pre
      aria-hidden
      className="mt-8 overflow-x-auto text-[11px] leading-snug text-[color:var(--ink-faint)]"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >{`  git push ─▶  [bridge :3010]  ─▶  docker build  ─▶  pod /public/sites/...
              └ smart-http +              └ node:22-alpine   └ owned by your WebID
                push tokens                 --rm --user $uid`}</pre>
  );
}

function DemoCard({
  demo,
  live,
  featured,
}: {
  demo: DemoConfig;
  live: string | null;
  featured?: boolean;
}) {
  const detailLabel = demo.detailLabel ?? "build log";
  const detailHref = demo.detailPath
    ? `/repos/${demo.owner}/${demo.name}/${demo.detailPath}`
    : `/repos/${demo.owner}/${demo.name}/runs`;
  return (
    <li
      className="card"
      style={
        featured
          ? {
              borderColor: "var(--accent)",
              background:
                "color-mix(in srgb, var(--accent) 12%, var(--paper-soft))",
            }
          : undefined
      }
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <Link
            href={`/repos/${demo.owner}/${demo.name}`}
            className={`display hover:text-[color:var(--accent)] ${
              featured ? "text-2xl" : "text-xl"
            }`}
            style={{ fontFamily: "var(--font-display)" }}
          >
            {demo.owner}
            <span className="text-[color:var(--ink-faint)]">/</span>
            {demo.name}
          </Link>
          {featured ? (
            <span
              className="text-[9px] uppercase tracking-[0.22em] text-[color:var(--accent-deep)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              start here
            </span>
          ) : null}
        </div>
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.18em]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          {live ? (
            <a
              href={live}
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--accent)] hover:text-[color:var(--accent-deep)]"
            >
              live site →
            </a>
          ) : null}
          <Link
            href={detailHref}
            className="text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
          >
            {detailLabel} →
          </Link>
        </div>
      </div>
      <p
        className={`mt-1 text-[color:var(--ink-soft)] ${
          featured ? "text-[15px]" : "text-sm"
        }`}
      >
        {demo.blurb}
      </p>
    </li>
  );
}

function QuickstartStep({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <span
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--accent)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {number}
          </span>
          <h3
            className="display text-lg"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {title}
          </h3>
        </div>
        <CopyButton value={body} />
      </div>
      <pre className="codeblock mt-3">{body}</pre>
    </div>
  );
}
