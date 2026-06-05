import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo, getPagesConfig } from "@/lib/registry/repos";
import { listPushTokens } from "@/lib/registry/tokens";
import { getEnv } from "@/lib/env";
import { ensureAgentsBootstrap } from "@/lib/agents/bootstrap";
import { listRoles, getDefaultDriverName } from "@/lib/agents/registry";
import { readSession } from "@/lib/auth/session";
import { resolveCoderConfigSummary } from "@/lib/ai-providers/store";
import { TokenManager } from "../token-manager";
import { RepoTabs } from "../repo-tabs";
import {
  GeneralForm,
  PagesForm,
  DangerZone,
} from "./settings-forms";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function RepoSettingsPage({ params }: PageProps) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) notFound();

  // Owner-only page. Mutation routes are already requireOwner-gated, but
  // we also hide the editor itself so non-owners get an honest "no" page
  // instead of a working-looking form that 403s on submit.
  const session = await readSession();
  if (!session) return <SignInWall owner={owner} name={name} />;
  if (session.webId !== repo.ownerWebId) {
    return (
      <ForbiddenWall
        owner={owner}
        name={name}
        viewerWebId={session.webId}
        ownerWebId={repo.ownerWebId}
      />
    );
  }

  ensureAgentsBootstrap();

  const pages = getPagesConfig(repo.id);
  const tokens = listPushTokens(repo.id);
  const env = getEnv();
  const roles = listRoles();
  const defaultDriver = getDefaultDriverName();
  const runnerMode = env.mindRunner; // "auto" | "docker" | "native"
  const coderConfig = resolveCoderConfigSummary(repo.ownerWebId);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}`} className="link">
          ← {owner}/{name}
        </Link>
      </p>
      <h1
        className="display mt-3 break-words text-3xl sm:text-4xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Settings
      </h1>
      <p
        className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {repo.owner} / {repo.name} · only the owner can change these
      </p>

      <RepoTabs owner={owner} name={name} active="settings" />

      <div className="mt-10 grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-12">
        <SectionNav />

        <div className="min-w-0 space-y-12">
          <Section id="general" title="General" mark="// general">
            <GeneralForm
              owner={owner}
              name={name}
              visibility={repo.visibility}
              defaultBranch={repo.defaultBranch}
              proposalsEnabled={repo.proposalsEnabled}
              collabEnabled={repo.collabEnabled}
            />
          </Section>

          <Section id="pages" title="Mind Pages" mark="// pages">
            <PagesForm
              owner={owner}
              name={name}
              initial={{
                enabled: pages?.enabled ?? false,
                sourceBranch: pages?.sourceBranch ?? repo.defaultBranch,
                sourcePath: pages?.sourcePath ?? "/",
                targetContainer:
                  pages?.targetContainer ??
                  `${trailingSlash(repo.ownerPodRoot)}public/sites/${repo.name}/`,
              }}
            />
          </Section>

          <Section id="tokens" title="Push tokens" mark="// tokens">
            <p className="mb-4 max-w-2xl text-sm text-[color:var(--ink-soft)]">
              Every <code className="kbd">git push</code> needs a token.
              Tokens are scoped to this repo and shown in plaintext exactly
              once at creation. Lose it and you mint a new one.
            </p>
            <TokenManager owner={owner} repo={name} initial={tokens} />
          </Section>

          <Section id="agents" title="Agents" mark="// agents">
            <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              <dt className="text-[color:var(--ink-faint)]">Provider</dt>
              <dd>
                {coderConfig.source === "none" ? (
                  <span className="text-[color:var(--status-bad)]">
                    none configured —{" "}
                    <Link href="/profile/ai-providers" className="link">
                      add a key
                    </Link>
                  </span>
                ) : (
                  <>
                    <code className="kbd">{coderConfig.providerLabel}</code>
                    {coderConfig.source === "user-pref" ? (
                      <span className="ml-2 text-[11px] text-[color:var(--ink-faint)]">
                        owner&apos;s key
                      </span>
                    ) : (
                      <span className="ml-2 text-[11px] text-[color:var(--ink-faint)]">
                        bridge default
                      </span>
                    )}
                  </>
                )}
              </dd>
              <dt className="text-[color:var(--ink-faint)]">Model</dt>
              <dd>
                {coderConfig.source === "none" ? (
                  <span className="text-[color:var(--ink-faint)]">—</span>
                ) : (
                  <code className="kbd">{coderConfig.model}</code>
                )}
              </dd>
              <dt className="text-[color:var(--ink-faint)]">Default driver</dt>
              <dd>
                <code className="kbd">{defaultDriver ?? "—"}</code>
                {defaultDriver === "echo" ? (
                  <span className="ml-2 text-[11px] text-[color:var(--ink-faint)]">
                    no key set — agents log only
                  </span>
                ) : null}
              </dd>
              <dt className="text-[color:var(--ink-faint)]">Coder image</dt>
              <dd>
                <code className="kbd">{env.coderImage}</code>
              </dd>
              <dt className="text-[color:var(--ink-faint)]">Coder timeout</dt>
              <dd>
                {Math.round(env.coderTimeoutMs / 1000)}s per run
              </dd>
            </div>
            <p className="mt-4 max-w-2xl text-[11px] leading-relaxed text-[color:var(--ink-faint)]">
              Provider + model are owned by{" "}
              <Link href="/profile/ai-providers" className="link">
                the owner&apos;s AI providers vault
              </Link>
              . Per-repo overrides aren&apos;t supported yet.
            </p>

            <h3
              className="mt-6 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              Roster
            </h3>
            {roles.length === 0 ? (
              <p className="mt-2 text-sm text-[color:var(--ink-soft)]">
                No roles registered.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-[color:var(--ink-trace)]">
                {roles.map((role) => (
                  <li key={role.name} className="py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-3">
                      <span
                        className="text-[12px] uppercase tracking-[0.18em] text-[color:var(--ink)]"
                        style={{ fontFamily: "var(--font-mono-src)" }}
                      >
                        {role.name}
                      </span>
                      <span
                        className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
                        style={{ fontFamily: "var(--font-mono-src)" }}
                      >
                        driver · {role.driver ?? defaultDriver ?? "—"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
                      {role.summary}
                    </p>
                    <p
                      className="mt-1 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
                      style={{ fontFamily: "var(--font-mono-src)" }}
                    >
                      fires on{" "}
                      {role.triggers
                        .map((t) =>
                          t.on === "issue.labeled"
                            ? `issue.labeled(${t.label})`
                            : t.on,
                        )
                        .join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-[11px] text-[color:var(--ink-faint)]">
              Roster is defined in code (
              <code className="kbd">src/lib/agents/bootstrap.ts</code>) and
              applies to every repo. Per-repo overrides are not implemented.
            </p>
          </Section>

          <Section id="runner" title="Workflow runner" mark="// runner">
            <div className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              <dt className="text-[color:var(--ink-faint)]">Mode</dt>
              <dd>
                <code className="kbd">
                  MIND_RUNNER={runnerMode}
                </code>
                <span className="ml-2 text-[11px] text-[color:var(--ink-faint)]">
                  {runnerMode === "auto"
                    ? "docker if reachable, native otherwise"
                    : runnerMode === "docker"
                      ? "forced docker (errors if unavailable)"
                      : "forced native — host shell, no sandbox"}
                </span>
              </dd>
              <dt className="text-[color:var(--ink-faint)]">Image</dt>
              <dd>
                <code className="kbd">node:22-alpine</code>
              </dd>
            </div>
            <p className="mt-4 max-w-2xl text-[11px] leading-relaxed text-[color:var(--ink-faint)]">
              Workflow steps from <code className="kbd">.mind/workflow.yml</code>{" "}
              run on push. The mode is process-global and set via the{" "}
              <code className="kbd">MIND_RUNNER</code> environment variable.
            </p>
          </Section>

          <Section id="danger" title="Danger zone" mark="// danger">
            <DangerZone owner={owner} name={name} />
          </Section>
        </div>
      </div>
    </div>
  );
}

function SectionNav() {
  const items: { id: string; label: string }[] = [
    { id: "general", label: "General" },
    { id: "pages", label: "Mind Pages" },
    { id: "tokens", label: "Push tokens" },
    { id: "agents", label: "Agents" },
    { id: "runner", label: "Workflow runner" },
    { id: "danger", label: "Danger zone" },
  ];
  return (
    <aside className="lg:sticky lg:top-6 lg:self-start">
      <nav
        className="flex flex-row flex-wrap gap-x-3 gap-y-1 border-b border-[color:var(--ink-trace)] pb-3 text-[11px] uppercase tracking-[0.18em] lg:flex-col lg:border-b-0 lg:border-l lg:border-[color:var(--ink-trace)] lg:gap-y-2 lg:pb-0 lg:pl-3"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            className="text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
          >
            {it.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}

function Section({
  id,
  title,
  mark,
  children,
}: {
  id: string;
  title: string;
  mark: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      <p className="section-mark">{mark}</p>
      <h2
        className="display mt-1 text-2xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h2>
      <hr className="hairline mt-3" />
      <div className="mt-5">{children}</div>
    </section>
  );
}

function trailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function SignInWall({ owner, name }: { owner: string; name: string }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-10">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}`} className="link">
          ← {owner}/{name}
        </Link>
      </p>
      <h1
        className="display mt-3 text-3xl sm:text-4xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Sign in to <em>configure</em>.
      </h1>
      <p className="mt-5 max-w-2xl leading-relaxed text-[color:var(--ink-soft)]">
        Repo settings are owner-only. Connect the WebID that owns{" "}
        <code className="kbd">{owner}/{name}</code> to see and change them.
      </p>
      <div className="mt-6">
        <Link
          href="/connect"
          className="inline-flex items-center gap-2 rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-1.5 text-[12px] uppercase tracking-[0.18em] text-[color:var(--paper)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Connect a pod →
        </Link>
      </div>
    </div>
  );
}

function ForbiddenWall({
  owner,
  name,
  viewerWebId,
  ownerWebId,
}: {
  owner: string;
  name: string;
  viewerWebId: string;
  ownerWebId: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-10">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}`} className="link">
          ← {owner}/{name}
        </Link>
      </p>
      <h1
        className="display mt-3 text-3xl sm:text-4xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Only the owner can <em>configure</em> this.
      </h1>
      <p className="mt-5 max-w-2xl leading-relaxed text-[color:var(--ink-soft)]">
        Settings, tokens, Pages config, and deletion are restricted to the
        WebID that owns the repo.
      </p>
      <dl className="mt-6 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
        <dt className="text-[color:var(--ink-faint)]">You are signed in as</dt>
        <dd>
          <code
            className="break-all text-[12px]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {viewerWebId}
          </code>
        </dd>
        <dt className="text-[color:var(--ink-faint)]">Owner WebID</dt>
        <dd>
          <code
            className="break-all text-[12px]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {ownerWebId}
          </code>
        </dd>
      </dl>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href={`/repos/${owner}/${name}`}
          className="inline-flex items-center gap-2 rounded border border-[color:var(--ink-trace)] px-4 py-1.5 text-[12px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          ← back to repo
        </Link>
        <Link
          href="/identities"
          className="inline-flex items-center gap-2 rounded border border-[color:var(--accent)] px-4 py-1.5 text-[12px] uppercase tracking-[0.18em] text-[color:var(--accent)] hover:bg-[color:var(--accent-soft)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Switch identity →
        </Link>
      </div>
    </div>
  );
}
