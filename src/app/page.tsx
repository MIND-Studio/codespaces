import Link from "next/link";
import { listRepos, getRepoById, getPagesConfig } from "@/lib/registry/repos";
import {
  countAllRuns,
  getLatestRunOverall,
  listRunsForRepo,
  type WorkflowRun,
} from "@/lib/registry/runs";
import { RelativeTime } from "@/components/relative-time";
import { readSession } from "@/lib/auth/session";
import { getUserByWebId } from "@/lib/registry/users";

export const dynamic = "force-dynamic";

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
 * walk-through instead.
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

export default async function LandingPage() {
  const session = await readSession();
  const signedIn = !!session;
  const user = session ? getUserByWebId(session.webId) : null;
  const ownerSlug = user?.ownerSlug ?? null;

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

  // Returning-user shortcut: surface the most recently-touched repo this
  // WebID owns so the hero can offer "pick up where you left off".
  const myLatestRepo = signedIn
    ? repos
        .filter((r) => r.ownerWebId === session!.webId)
        .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
    : null;

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
        Your code · <span style={{ color: "var(--accent)" }}>your context</span>{" "}
        · your pod.
      </p>
      <p className="mt-6 text-lg leading-relaxed text-[color:var(--ink-soft)]">
        Mind Codespaces is an AI-native Git platform built around your own
        Solid Pod. Push code, file issues, let an agent draft pull requests —
        and the artifacts, history, and AI memory stay under <em>your</em>{" "}
        WebID. The bridge translates protocols; it doesn&apos;t own your
        project.
      </p>

      <HeroCtas
        signedIn={signedIn}
        ownerSlug={ownerSlug}
        myLatestRepo={
          myLatestRepo
            ? { owner: myLatestRepo.owner, name: myLatestRepo.name }
            : null
        }
      />

      <hr className="hairline my-12" />

      <Pillars />

      {seeded ? (
        <>
          <hr className="hairline my-12" />
          <Section title="Live in this bridge">
            <div className="grid grid-cols-3 gap-3 sm:gap-8">
              <Stat label="repos" value={repos.length.toString()} />
              <Stat label="runs" value={runCount.toString()} />
              <Stat
                label="last activity"
                value={
                  latestRun ? <RelativeTime ts={latestRun.startedAt} /> : "—"
                }
              />
            </div>
            {recentRuns.length > 0 ? <RunSparkline runs={recentRuns} /> : null}
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
        </>
      ) : null}

      {livingDemos.length > 0 ? (
        <>
          <hr className="hairline my-12" />
          <Section title="See it working">
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

      <StartHere signedIn={signedIn} seeded={seeded} ownerSlug={ownerSlug} />

      <p className="mt-12 text-sm leading-relaxed text-[color:var(--ink-soft)]">
        Want the deep dive?{" "}
        <Link href="/how-it-works" className="link">
          How it works
        </Link>{" "}
        walks through what lives in your pod, what happens on push, and what
        survives if the bridge disappears. The{" "}
        <Link href="/docs/PRD.md" className="link">
          PRD
        </Link>{" "}
        has the original spec.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Hero CTAs — session-aware                                            */
/* -------------------------------------------------------------------- */

function HeroCtas({
  signedIn,
  ownerSlug,
  myLatestRepo,
}: {
  signedIn: boolean;
  ownerSlug: string | null;
  myLatestRepo: { owner: string; name: string } | null;
}) {
  if (!signedIn) {
    return (
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href="/signup"
          className="rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm text-[color:var(--paper)] transition-opacity hover:opacity-90"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Create your pod →
        </Link>
        <Link
          href="/login"
          className="rounded border border-[color:var(--ink-trace)] px-4 py-2 text-sm transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Sign in
        </Link>
        <Link
          href="/repos"
          className="rounded border border-[color:var(--ink-trace)] px-4 py-2 text-sm transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Browse repos
        </Link>
      </div>
    );
  }
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      {myLatestRepo ? (
        <Link
          href={`/repos/${myLatestRepo.owner}/${myLatestRepo.name}`}
          className="rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm text-[color:var(--paper)] transition-opacity hover:opacity-90"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Resume {myLatestRepo.owner}/{myLatestRepo.name} →
        </Link>
      ) : (
        <Link
          href="/repos/new"
          className="rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm text-[color:var(--paper)] transition-opacity hover:opacity-90"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          + Create your first repo
        </Link>
      )}
      <Link
        href="/repos"
        className="rounded border border-[color:var(--ink-trace)] px-4 py-2 text-sm transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        Open dashboard →
      </Link>
      {ownerSlug ? (
        <Link
          href={`/people/${ownerSlug}`}
          className="rounded border border-[color:var(--ink-trace)] px-4 py-2 text-sm transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Your profile
        </Link>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Pillars — what you actually get                                      */
/* -------------------------------------------------------------------- */

function Pillars() {
  const items: { kicker: string; title: string; body: React.ReactNode }[] = [
    {
      kicker: "01",
      title: "Pod-native repos",
      body: (
        <>
          A real bare Git repository on the bridge, plus a Turtle description
          of the project written to <em>your</em> pod under{" "}
          <code className="kbd">/codespaces/</code>. Move bridges, your repo
          metadata moves with you.
        </>
      ),
    },
    {
      kicker: "02",
      title: "Conversational dev",
      body: (
        <>
          File an issue and a single conversational <em>coder</em> agent
          responds against the same WebID, either editing files or asking a
          follow-up in the thread. Their working memory lands back in your
          pod, not in a vendor database.
        </>
      ),
    },
    {
      kicker: "03",
      title: "Mind Pages",
      body: (
        <>
          A <code className="kbd">git push</code> publishes a static site to a
          container of your choice on your pod. Visitors hit your pod
          directly; the bridge is out of the loop after publish.
        </>
      ),
    },
  ];
  return (
    <Section title="What this is">
      <p className="mb-6 text-sm text-[color:var(--ink-soft)]">
        Three primitives, all pod-owned. Each can be replaced or rebuilt
        without losing what matters — because what matters lives in the pod.
      </p>
      <ul className="grid gap-4 sm:grid-cols-3">
        {items.map((item) => (
          <li
            key={item.kicker}
            className="card flex flex-col gap-2"
            style={{ borderColor: "var(--ink-trace)" }}
          >
            <span
              className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--accent)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              {item.kicker}
            </span>
            <h3
              className="display text-xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {item.title}
            </h3>
            <p className="text-sm leading-relaxed text-[color:var(--ink-soft)]">
              {item.body}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* -------------------------------------------------------------------- */
/* Start here — session-aware walkthrough (replaces API quickstart)     */
/* -------------------------------------------------------------------- */

function StartHere({
  signedIn,
  seeded,
  ownerSlug,
}: {
  signedIn: boolean;
  seeded: boolean;
  ownerSlug: string | null;
}) {
  if (!signedIn) {
    const steps = [
      {
        n: "01",
        title: "Create a pod",
        body: "Pick a pod name and an email. The bridge spins up a Community Solid Server account and hands you back a WebID.",
        cta: { href: "/signup", label: "Sign up →" },
      },
      {
        n: "02",
        title: "Authorize the bridge",
        body: "An OIDC redirect to your pod. You approve once; the bridge gets a delegated refresh token it can revoke any time.",
        cta: { href: "/connect", label: "Connect a pod" },
      },
      {
        n: "03",
        title: "Create your first repo",
        body: "Name it, pick public or private, the bridge sets up a bare git repo and writes the metadata into your pod.",
        cta: { href: "/repos/new", label: "New repo →" },
      },
      {
        n: "04",
        title: "Push your code",
        body: "Mint a push token from the repo page, then git push to the bridge URL. Mind Pages publishes the result to your pod.",
        cta: { href: "/repos", label: "Repo dashboard" },
      },
    ];
    return (
      <Section title="Start here" id="start-here">
        <p className="mb-5 text-sm text-[color:var(--ink-soft)]">
          Four moves from nothing to a live site published from your pod.
          Everything happens in the app — no curl required.
          {seeded ? (
            <>
              {" "}
              Or skip ahead and{" "}
              <Link href="/people/alice" className="link">
                see what alice did
              </Link>
              .
            </>
          ) : null}
        </p>
        <ol className="grid gap-3 sm:grid-cols-2">
          {steps.map((s) => (
            <StepCard key={s.n} {...s} />
          ))}
        </ol>
      </Section>
    );
  }

  // Signed in.
  const steps = [
    {
      n: "01",
      title: "Create a repo",
      body: "Bare git on the bridge, Turtle description in your pod under /codespaces/{name}/.",
      cta: { href: "/repos/new", label: "+ New repo" },
    },
    {
      n: "02",
      title: "Enable Mind Pages",
      body: "On the repo's settings tab, point it at a container in your pod (e.g. /public/sites/hello/).",
      cta: { href: "/repos", label: "Pick a repo" },
    },
    {
      n: "03",
      title: "Push and publish",
      body: "Mint a token on the repo page, git push, and the bridge publishes the result to your pod.",
      cta: ownerSlug
        ? { href: `/people/${ownerSlug}`, label: "Your profile" }
        : { href: "/repos", label: "Repo dashboard" },
    },
  ];
  return (
    <Section title="Three moves from here">
      <p className="mb-5 text-sm text-[color:var(--ink-soft)]">
        You&apos;ve got a pod and a session. From here it&apos;s repo →
        pages → push.
      </p>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((s) => (
          <StepCard key={s.n} {...s} />
        ))}
      </ol>
    </Section>
  );
}

function StepCard({
  n,
  title,
  body,
  cta,
}: {
  n: string;
  title: string;
  body: string;
  cta: { href: string; label: string };
}) {
  return (
    <li className="card flex flex-col gap-2">
      <span
        className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--accent)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {n}
      </span>
      <h3
        className="display text-lg"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-[color:var(--ink-soft)]">
        {body}
      </p>
      <Link
        href={cta.href}
        className="mt-1 inline-block self-start text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)] hover:text-[color:var(--accent-deep)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {cta.label}
      </Link>
    </li>
  );
}

/* -------------------------------------------------------------------- */
/* Re-used display primitives (untouched from the previous landing)     */
/* -------------------------------------------------------------------- */

function Section({
  title,
  children,
  id,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={id ? "scroll-mt-20" : undefined}>
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
