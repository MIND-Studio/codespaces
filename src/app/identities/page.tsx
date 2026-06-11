import Link from "next/link";
import { listIdentities, type Identity } from "@/lib/registry/identities";
import { listRepos, type Repo } from "@/lib/registry/repos";
import { IdentityRow } from "./identity-row";

export const dynamic = "force-dynamic";

export default function IdentitiesPage() {
  const identities = listIdentities();
  const repos = listRepos();
  const reposByWebId = groupReposByWebId(repos);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-10 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <p className="section-mark">Identity</p>
          <h1
            className="display mt-3 text-3xl sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Connected <em>pods</em>.
          </h1>
        </div>
        {identities.length > 0 ? (
          <Link
            href="/connect"
            className="text-[11px] uppercase tracking-[0.22em] px-3 py-1.5 transition-colors"
            style={{
              fontFamily: "var(--font-mono-src)",
              border: "1px solid var(--ink-trace)",
              color: "var(--ink-soft)",
              background: "transparent",
            }}
          >
            + connect another pod
          </Link>
        ) : null}
      </div>
      <p className="mt-4 text-[color:var(--ink-soft)]">
        WebIDs that have authorized this bridge. Their refresh tokens live
        in <code className="kbd">.registry-data/</code> — disconnect to
        revoke.
      </p>

      <hr className="hairline my-8" />

      {identities.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="flex flex-col gap-4">
          {identities.map((id) => (
            <IdentityRow
              key={id.webId}
              identity={id}
              ownedRepos={(reposByWebId.get(id.webId) ?? []).map((r) => ({
                id: r.id,
                owner: r.owner,
                name: r.name,
                visibility: r.visibility,
              }))}
              podRoot={pickPodRoot(reposByWebId.get(id.webId), id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card">
      <p
        className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        // no identities connected
      </p>
      <p
        className="display mt-3 text-2xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Running on <em>seeded credentials</em>.
      </p>
      <p className="mt-3 text-[color:var(--ink-soft)]">
        The publisher is signing writes with a shared dev account
        (<code className="kbd">alice@mind.local</code>). Authorize
        a real pod to swap in a delegated refresh token — repos owned by
        that WebID will publish under your own identity.
      </p>
      <div className="mt-5">
        <Link
          href="/connect"
          className="inline-block rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-4 py-2 text-sm text-[color:var(--paper)]"
        >
          Connect a pod
        </Link>
      </div>
    </div>
  );
}

function groupReposByWebId(repos: Repo[]): Map<string, Repo[]> {
  const out = new Map<string, Repo[]>();
  for (const r of repos) {
    const list = out.get(r.ownerWebId);
    if (list) list.push(r);
    else out.set(r.ownerWebId, [r]);
  }
  return out;
}

function pickPodRoot(repos: Repo[] | undefined, identity: Identity): string {
  if (repos && repos.length > 0) return repos[0].ownerPodRoot;
  try {
    const u = new URL(identity.webId);
    const segs = u.pathname.split("/").filter(Boolean);
    if (segs.length > 0) {
      return `${u.origin}/${segs[0]}/`;
    }
    return `${u.origin}/`;
  } catch {
    return "";
  }
}
