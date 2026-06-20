import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { nameFromWebId } from "@/lib/collab/config";
import { repoPath } from "@/lib/git/backend";
import { getRepo } from "@/lib/registry/repos";
import { getUserByWebId } from "@/lib/registry/users";
import { readGitTracker } from "@/lib/tracker/read";
import { RepoTabs } from "../../../repo-tabs";
import { DraftLoader } from "./draft-loader";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string; draftId: string }>;
};

/**
 * Collaborative composer for a new issue/epic. The route's `draftId` is the
 * multiplayer room: anyone with the link (who can sign in) co-edits the same
 * Yjs doc; on "Create" the draft is committed to the repo's `.mind` tracker.
 */
export default async function NewDraftPage({ params }: PageProps) {
  const { owner, repo: name, draftId } = await params;
  const repo = getRepo(owner, name);
  if (!repo) notFound();

  // Editing requires a session (any signed-in WebID can co-draft; only the
  // owner can commit). Bounce to sign-in, preserving the draft URL.
  const session = await readSession();
  if (!session) {
    redirect(
      `/login?next=${encodeURIComponent(`/repos/${owner}/${name}/issues/draft/${draftId}`)}`,
    );
  }

  const tracker = await readGitTracker(repoPath(repo.owner, repo.name), owner, name);
  if (!tracker) notFound();

  // Categories: value is the lowercase config id (= label); the author resolves
  // it back to the `.mind` `type:`. Epics: slug + title (General handled inline).
  const categories = tracker.categories.map((c) => ({ id: c.label, label: c.label }));
  const epics = tracker.epics.map((e) => ({ slug: e.slug, title: e.title }));

  const isOwner = session.webId === repo.ownerWebId;
  const displayName = getUserByWebId(session.webId)?.ownerSlug ?? nameFromWebId(session.webId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}/issues`} className="link">
          ← issues
        </Link>
      </p>
      <h1 className="mt-3 display text-3xl" style={{ fontFamily: "var(--font-display)" }}>
        New draft
      </h1>
      <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
        {repo.collabEnabled
          ? "Co-write it live, then commit it as an issue or an epic."
          : "Draft it, then commit it as an issue or an epic."}
      </p>

      <RepoTabs owner={owner} name={name} active="issues" />

      <div className="mt-6">
        <DraftLoader
          owner={owner}
          repo={name}
          draftId={draftId}
          isOwner={isOwner}
          collab={repo.collabEnabled}
          user={{ webId: session.webId, name: displayName }}
          categories={categories}
          epics={epics}
        />
      </div>
    </div>
  );
}
