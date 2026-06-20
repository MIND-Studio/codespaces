import Link from "next/link";
import { notFound } from "next/navigation";
import { repoPath } from "@/lib/git/backend";
import { getRepo } from "@/lib/registry/repos";
import { readGitTracker } from "@/lib/tracker/read";
import { RepoTabs } from "../../repo-tabs";
import { NewIssueForm } from "./new-issue-form";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function NewIssuePage({ params }: PageProps) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) notFound();

  const tracker = await readGitTracker(repoPath(repo.owner, repo.name), owner, name);
  if (!tracker) notFound();

  // Categories: value is the lowercase config id (the label); the author resolves
  // it back to the `.mind` `type:`. Epics: slug + title (General handled inline).
  const categories = tracker.categories.map((c) => ({ id: c.label, label: c.label }));
  const epics = tracker.epics.map((e) => ({ slug: e.slug, title: e.title }));

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}/issues`} className="link">
          ← issues
        </Link>
      </p>
      <h1 className="mt-3 display text-3xl" style={{ fontFamily: "var(--font-display)" }}>
        New issue
      </h1>

      <RepoTabs owner={owner} name={name} active="issues" />

      <div className="mt-6">
        <NewIssueForm owner={owner} repo={name} categories={categories} epics={epics} />
      </div>
    </div>
  );
}
