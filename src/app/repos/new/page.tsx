import Link from "next/link";
import { readSession } from "@/lib/auth/session";
import { getUserByWebId } from "@/lib/registry/users";
import { listRepos } from "@/lib/registry/repos";
import { NewRepoForm } from "./new-repo-form";

export const dynamic = "force-dynamic";

export default async function NewRepoPage() {
  const session = await readSession();

  if (!session) {
    return (
      <Shell>
        <p className="text-[color:var(--ink-soft)]">
          You need to be signed in to create a repository.
        </p>
        <p className="mt-4">
          <Link href="/login" className="link">
            Sign in
          </Link>{" "}
          or{" "}
          <Link href="/signup" className="link">
            create a pod
          </Link>
          .
        </p>
      </Shell>
    );
  }

  // Resolve the owner slug + pod root from the users row, falling back to
  // an existing repo this WebID owns (mirrors the heuristic in
  // AuthCtaServer). Without those, the user has a session but no pod
  // record we can map to — point them at signup to register one.
  const user = getUserByWebId(session.webId);
  let owner = user?.ownerSlug ?? null;
  let podRoot = user?.podRoot ?? null;
  if (!owner || !podRoot) {
    const existing = listRepos().find((r) => r.ownerWebId === session.webId);
    if (existing) {
      owner = owner ?? existing.owner;
      podRoot = podRoot ?? existing.ownerPodRoot;
    }
  }

  if (!owner || !podRoot) {
    return (
      <Shell>
        <p className="text-[color:var(--ink-soft)]">
          Your session is signed in but we don&apos;t have an owner slug or
          pod root on file yet. Finish signing up to register your pod with
          this bridge.
        </p>
        <p className="mt-4">
          <Link href="/signup" className="link">
            Complete signup
          </Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <NewRepoForm
        owner={owner}
        ownerWebId={session.webId}
        ownerPodRoot={podRoot}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-10 sm:py-12">
      <p className="section-mark">
        <Link href="/repos" className="link">
          Repos
        </Link>{" "}
        / New
      </p>
      <h1
        className="display mt-3 text-3xl sm:text-4xl md:text-5xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        New <em>repo</em>.
      </h1>
      <p className="mt-4 max-w-xl text-[color:var(--ink-soft)]">
        Creates a bare Git repository on this bridge and writes a Turtle
        description into your pod under{" "}
        <code className="kbd">/codespaces/{"{name}"}/index.ttl</code>. You
        can enable Mind Pages and mint push tokens from the repo&apos;s
        detail page afterwards.
      </p>

      <hr className="hairline my-8" />

      {children}
    </div>
  );
}
