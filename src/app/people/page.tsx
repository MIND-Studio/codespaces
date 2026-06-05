import Link from "next/link";
import { Button, Input } from "@mind-studio/ui";
import { listRepos, type Repo } from "@/lib/registry/repos";
import ProfileView from "./profile-view";

export const dynamic = "force-dynamic";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ webid?: string }>;
}) {
  const { webid } = await searchParams;
  const repos = listRepos();
  const localPeople = uniqueByWebId(repos);

  if (webid) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
        <p
          className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <Link href="/people" className="hover:text-[color:var(--accent)]">
            People
          </Link>{" "}
          / arbitrary WebID
        </p>
        <div className="mt-6">
          <ProfileView webId={webid} />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-16 sm:px-10">
      <p className="section-mark">People</p>
      <h1
        className="display mt-4 text-5xl sm:text-6xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Profiles, <em>read from pods.</em>
      </h1>
      <p className="mt-6 text-lg leading-relaxed text-[color:var(--ink-soft)]">
        The bridge doesn't store names, bios, or avatars. Every field on a
        profile page is fetched live from the WebID URL and rendered as-is. If
        a field isn't in the pod, the page says so.
      </p>

      <hr className="hairline my-10" />

      <Section title="Seeded locally">
        <p className="mb-4 text-sm text-[color:var(--ink-soft)]">
          People with at least one repo in this bridge. Profiles enriched by{" "}
          <code className="kbd">npm run seed:profiles</code>.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {localPeople.map((p) => (
            <li key={p.owner}>
              <Link
                href={`/people/${p.owner}`}
                className="card block transition-colors hover:border-[color:var(--accent)]"
              >
                <div
                  className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
                  style={{ fontFamily: "var(--font-mono-src)" }}
                >
                  /people/{p.owner}
                </div>
                <div
                  className="display mt-1 text-xl"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  @{p.owner}
                </div>
                <div
                  className="mt-2 break-all text-[11px] text-[color:var(--ink-faint)]"
                  style={{ fontFamily: "var(--font-mono-src)" }}
                >
                  {p.ownerWebId}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <hr className="hairline my-10" />

      <Section title="Anywhere on the open web">
        <p className="mb-4 text-sm text-[color:var(--ink-soft)]">
          Paste any public WebID URL. The bridge will dereference it and render
          whatever it finds — including profiles hosted on other Solid servers
          that have never heard of this bridge.
        </p>
        <form className="flex flex-wrap gap-2" action="/people" method="get">
          <Input
            type="url"
            name="webid"
            required
            placeholder="https://example.solidcommunity.net/profile/card#me"
            className="flex-1 min-w-0 text-sm"
            style={{ fontFamily: "var(--font-mono-src)" }}
          />
          <Button type="submit" variant="default" size="sm">
            Look up →
          </Button>
        </form>
        <p className="mt-3 text-xs text-[color:var(--ink-faint)]">
          Tip: this works for any WebID whose document is public-read — the
          bridge dereferences the URL with no auth.
        </p>
      </Section>
    </div>
  );
}

function uniqueByWebId(repos: Repo[]): Repo[] {
  const seen = new Set<string>();
  const out: Repo[] = [];
  for (const r of repos) {
    if (seen.has(r.ownerWebId)) continue;
    seen.add(r.ownerWebId);
    out.push(r);
  }
  return out.sort((a, b) => a.owner.localeCompare(b.owner));
}

function Section({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
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
