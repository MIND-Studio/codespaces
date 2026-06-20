import Link from "next/link";
import { notFound } from "next/navigation";
import { listRepos } from "@/lib/registry/repos";
import ProfileView from "../profile-view";

export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ owner: string }> }) {
  const { owner } = await params;
  const repos = listRepos();
  const ownerRepo = repos.find((r) => r.owner === owner);
  if (!ownerRepo) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
      <p
        className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        <Link href="/people" className="hover:text-[color:var(--accent)]">
          People
        </Link>{" "}
        / {owner}
      </p>
      <div className="mt-6">
        <ProfileView webId={ownerRepo.ownerWebId} />
      </div>
    </div>
  );
}
