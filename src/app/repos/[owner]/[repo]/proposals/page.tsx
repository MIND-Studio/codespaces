import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { repoPath } from "@/lib/git/backend";
import { readSession } from "@/lib/auth/session";
import { readGitTracker } from "@/lib/tracker/read";
import { listProposals, type Proposal } from "@/lib/solid/inbox";
import { OwnerFetchUnavailableError } from "@/lib/solid/fetch-for-owner";
import { RelativeTime } from "@/components/relative-time";
import { RepoTabs } from "../repo-tabs";
import { ProposalActions } from "./proposal-actions";

export const dynamic = "force-dynamic";

const DEFAULT_CATEGORIES = ["feature", "bug", "refactor", "chore", "docs"];

type PageProps = { params: Promise<{ owner: string; repo: string }> };

export default async function ProposalsPage({ params }: PageProps) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) notFound();

  const session = await readSession();
  const isOwner = session?.webId === repo.ownerWebId;
  // The inbox is the owner's private review queue — don't even reveal it
  // exists to non-owners.
  if (!isOwner) notFound();

  const tracker = await readGitTracker(repoPath(repo.owner, repo.name), owner, name);
  // Accept mints a .mind issue, so it can only ever succeed once the repo has
  // a tracker scaffold on the default branch — surface that before the click.
  const hasTracker = tracker != null;
  const categories = (tracker?.categories.map((c) => c.label) ?? DEFAULT_CATEGORIES).map(
    (label) => ({ id: label, label }),
  );

  let proposals: Proposal[] = [];
  let podError: string | null = null;
  try {
    proposals = await listProposals(repo);
  } catch (e) {
    podError =
      e instanceof OwnerFetchUnavailableError
        ? "This pod needs reauthorization — reconnect it via /connect to read the inbox."
        : "Could not read the proposal inbox.";
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}`} className="link">
          ← {owner}/{name}
        </Link>
      </p>
      <h1
        className="mt-3 display text-3xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Proposals
      </h1>
      <p className="mt-2 text-sm text-[color:var(--ink-soft)]">
        Issue proposals submitted to this repo&apos;s pod inbox. Accept one to
        mint a <code className="kbd">.mind</code> issue at{" "}
        <code className="kbd">todo</code>, or dismiss it.
      </p>

      <RepoTabs owner={owner} name={name} active="proposals" />

      {!hasTracker ? (
        <section className="card mt-6 text-sm text-[color:var(--ink-soft)]">
          No <code className="kbd">.mind</code> tracker in this repo yet —
          proposals can be reviewed and dismissed, but{" "}
          <strong>Accept</strong> needs{" "}
          <code className="kbd">.mind/issues/tracker.config.md</code> on the
          default branch.
        </section>
      ) : null}

      {podError ? (
        <section className="card mt-6 text-sm" style={{ color: "var(--status-bad)" }}>
          {podError}
        </section>
      ) : proposals.length === 0 ? (
        <section className="card mt-6 text-sm text-[color:var(--ink-soft)]">
          <p
            className="display text-xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Inbox empty.
          </p>
          <p className="mt-2">
            No pending proposals. Anyone can submit one from the{" "}
            <Link href={`/repos/${owner}/${name}/issues/propose`} className="link">
              propose page
            </Link>
            .
          </p>
        </section>
      ) : (
        <ul className="mt-6 space-y-5">
          {proposals.map((p) => (
            <li key={p.id} className="card">
              <h2 className="text-base font-medium leading-snug text-[color:var(--ink)]">
                {p.title}
              </h2>
              <div
                className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
                style={{ fontFamily: "var(--font-mono-src)" }}
              >
                <span>
                  {p.proposerWebId ? (
                    <>by {p.proposerWebId}</>
                  ) : p.contact ? (
                    <>by {p.contact} (unverified)</>
                  ) : (
                    <>anonymous</>
                  )}
                </span>
                {p.createdAt ? (
                  <span>
                    <RelativeTime ts={p.createdAt} />
                  </span>
                ) : null}
              </div>
              {p.body ? (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--ink-soft)]">
                  {p.body}
                </p>
              ) : null}
              <ProposalActions
                owner={owner}
                repo={name}
                id={p.id}
                categories={categories}
                canAccept={hasTracker}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
