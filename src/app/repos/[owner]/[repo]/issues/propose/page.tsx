import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import { readSession } from "@/lib/auth/session";
import { ProposeForm } from "./propose-form";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ owner: string; repo: string }> };

export default async function ProposeIssuePage({ params }: PageProps) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) notFound();

  const session = await readSession();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}/issues`} className="link">
          ← {owner}/{name} · Issues
        </Link>
      </p>
      <h1
        className="mt-3 display text-3xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Propose an issue
      </h1>
      <p className="mt-2 text-sm text-[color:var(--ink-soft)]">
        Anyone can suggest work for <code className="kbd">{owner}/{name}</code>.
        Your proposal goes to the owner&apos;s pod inbox for review — it isn&apos;t
        added to the tracker until the owner accepts it.
      </p>

      {repo.proposalsEnabled ? (
        <ProposeForm
          owner={owner}
          repo={name}
          proposerWebId={session?.webId ?? null}
        />
      ) : (
        <section className="card mt-6 text-sm text-[color:var(--ink-soft)]">
          <p
            className="display text-xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Proposals are closed.
          </p>
          <p className="mt-2">
            The owner of <code className="kbd">{owner}/{name}</code> isn&apos;t
            accepting issue proposals right now.
          </p>
        </section>
      )}
    </div>
  );
}
