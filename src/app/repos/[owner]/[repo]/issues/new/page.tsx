import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { NewIssueForm } from "./new-issue-form";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

export default async function NewIssuePage({ params }: PageProps) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link
          href={`/repos/${owner}/${name}/issues`}
          className="link"
        >
          ← {owner}/{name}/issues
        </Link>
      </p>
      <h1
        className="display mt-3 text-3xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        New <em>issue</em>.
      </h1>
      <p className="mt-3 max-w-xl text-sm text-[color:var(--ink-soft)]">
        Filed against{" "}
        <code className="kbd">
          {repo.owner}/{repo.name}
        </code>
        . Written to your pod at{" "}
        <code className="kbd">
          /codespaces/{repo.name}/issues/&hellip;
        </code>
        .
      </p>

      <hr className="hairline my-8" />

      <NewIssueForm owner={owner} repo={name} />
    </div>
  );
}
