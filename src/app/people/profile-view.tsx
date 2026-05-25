import Link from "next/link";
import { fetchProfile, listContainer } from "@/lib/solid/profile";
import { listRepos, type Repo } from "@/lib/registry/repos";

function initials(name: string | null, fallback: string): string {
  const source = (name && name.trim().length > 0 ? name : fallback).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function podRootFromWebId(webId: string): string | null {
  try {
    const u = new URL(webId);
    return `${u.origin}${u.pathname.split("/")[1] ? "/" + u.pathname.split("/")[1] + "/" : "/"}`;
  } catch {
    return null;
  }
}

function lastSegment(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i >= 0 ? trimmed.slice(i + 1) : trimmed;
}

function originHostPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}${u.search}${u.hash}`;
  } catch {
    return url;
  }
}

function hostOnly(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function stripFragment(url: string): string {
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(0, i) : url;
}

function ownerSlugForWebId(webId: string, repos: Repo[]): string | null {
  const owner = repos.find((r) => r.ownerWebId === webId)?.owner;
  return owner ?? null;
}

function linkForKnown(webId: string, repos: Repo[]): string {
  const slug = ownerSlugForWebId(webId, repos);
  return slug ? `/people/${slug}` : `/people?webid=${encodeURIComponent(webId)}`;
}

export default async function ProfileView({ webId }: { webId: string }) {
  let profile;
  try {
    profile = await fetchProfile(webId);
  } catch (err) {
    return (
      <ErrorPanel
        webId={webId}
        message={err instanceof Error ? err.message : String(err)}
      />
    );
  }

  const repos = listRepos();
  const podRoot = podRootFromWebId(webId);

  const ownedReposFromBridge = repos.filter((r) => r.ownerWebId === webId);

  const [codespacesContainer, sitesContainer] = await Promise.all([
    podRoot ? listContainer(`${podRoot}codespaces/`) : Promise.resolve(null),
    podRoot ? listContainer(`${podRoot}public/sites/`) : Promise.resolve(null),
  ]);

  const reposFromPod = (codespacesContainer ?? [])
    .filter((u) => u.endsWith("/"))
    .map(lastSegment)
    .filter(Boolean);

  const sitesFromPod = (sitesContainer ?? [])
    .filter((u) => u.endsWith("/"))
    .map(lastSegment)
    .filter(Boolean);

  const ownerSlug = ownerSlugForWebId(webId, repos);
  const fallbackHandle = ownerSlug ?? lastSegment(stripFragment(webId));
  const displayName =
    profile.name ?? (profile.nick ? `@${profile.nick}` : `@${fallbackHandle}`);
  const initialsBadge = initials(profile.name, profile.nick ?? fallbackHandle);
  const issuerHost = profile.oidcIssuer
    ? hostOnly(profile.oidcIssuer)
    : hostOnly(profile.document);

  return (
    <article>
      <header className="flex flex-wrap items-start gap-6">
        {profile.img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={profile.img}
            alt=""
            width={80}
            height={80}
            className="h-20 w-20 shrink-0 rounded-full border border-[color:var(--ink-trace)] object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-[color:var(--ink-trace)] bg-[color:var(--accent-soft)] text-2xl text-[color:var(--accent-deep)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {initialsBadge}
          </div>
        )}
        <div className="min-w-0">
          <p className="section-mark">
            Profile{ownerSlug ? ` · ${ownerSlug}` : ""}
          </p>
          <h1
            className="display mt-2 text-4xl sm:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {displayName}
          </h1>
          <p
            className="mt-3 text-xs text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            // from <span className="text-[color:var(--ink-soft)]">{issuerHost}</span>
            {profile.nick && profile.name ? (
              <>
                {"  ·  "}@{profile.nick}
              </>
            ) : null}
          </p>
          {profile.bio ? (
            <p className="mt-4 max-w-prose text-base leading-relaxed text-[color:var(--ink-soft)]">
              {profile.bio}
            </p>
          ) : (
            <p className="mt-4 text-sm italic text-[color:var(--ink-faint)]">
              (no vcard:note in this profile)
            </p>
          )}
        </div>
      </header>

      <dl
        className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-3 border-t border-[color:var(--ink-trace)] pt-6 text-xs sm:grid-cols-[max-content_minmax(0,1fr)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        <DataRow label="WebID">
          <a
            href={profile.webId}
            target="_blank"
            rel="noreferrer"
            className="link break-all"
          >
            {originHostPath(profile.webId)}
          </a>
        </DataRow>
        <DataRow label="oidc issuer">
          {profile.oidcIssuer ? (
            <a
              href={profile.oidcIssuer}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              {originHostPath(profile.oidcIssuer)}
            </a>
          ) : (
            <Missing>solid:oidcIssuer</Missing>
          )}
        </DataRow>
        <DataRow label="homepage">
          {profile.homepage ? (
            <a
              href={profile.homepage}
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              {originHostPath(profile.homepage)}
            </a>
          ) : (
            <Missing>foaf:homepage</Missing>
          )}
        </DataRow>
        <DataRow label="types">
          {profile.types.length ? (
            <span>{profile.types.map(shorten).join(", ")}</span>
          ) : (
            <Missing>rdf:type</Missing>
          )}
        </DataRow>
        <DataRow label="pod root">
          {podRoot ? (
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="break-all">{podRoot}</span>
              <a
                href={podRoot}
                target="_blank"
                rel="noreferrer"
                className="link text-[10px] uppercase tracking-[0.18em]"
              >
                open pod →
              </a>
            </span>
          ) : (
            <Missing>derivable from WebID</Missing>
          )}
        </DataRow>
      </dl>

      <hr className="hairline my-10" />

      <Section title="Repos on this bridge">
        {ownedReposFromBridge.length === 0 ? (
          <p
            className="text-sm italic text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            No repos pushed yet on this bridge.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {ownedReposFromBridge
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/repos/${r.owner}/${r.name}`}
                    className="inline-flex items-baseline gap-2 rounded-[var(--radius-chip)] border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-3 py-1.5 text-xs transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
                    style={{ fontFamily: "var(--font-mono-src)" }}
                  >
                    <span className="text-[color:var(--ink-faint)]">
                      {r.owner}/
                    </span>
                    <span className="text-[color:var(--ink)]">{r.name}</span>
                    {r.visibility === "private" ? (
                      <span className="text-[9px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]">
                        priv
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </Section>

      <hr className="hairline my-10" />

      <Section title="Knows">
        {profile.knows.length === 0 ? (
          <p className="text-sm italic text-[color:var(--ink-faint)]">
            (no foaf:knows assertions in this profile)
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {profile.knows.map((w) => {
              const href = linkForKnown(w, repos);
              const slug = ownerSlugForWebId(w, repos);
              return (
                <li
                  key={w}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1"
                >
                  <Link href={href} className="link">
                    {slug ? `@${slug}` : "look up →"}
                  </Link>
                  <span
                    className="text-[10px] text-[color:var(--ink-faint)]"
                    style={{ fontFamily: "var(--font-mono-src)" }}
                  >
                    {originHostPath(w)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <hr className="hairline my-10" />

      <Section title="Repos">
        <p className="mb-4 text-sm text-[color:var(--ink-soft)]">
          Cross-referenced: which repos the bridge thinks this person owns vs.
          which ones their pod itself advertises in{" "}
          <code className="kbd">codespaces/</code>. The pod is authoritative.
        </p>
        <RepoCrossRef
          bridgeRepos={ownedReposFromBridge.map((r) => r.name)}
          podRepos={reposFromPod}
          containerExisted={codespacesContainer !== null}
        />
      </Section>

      <hr className="hairline my-10" />

      <Section title="Published sites">
        {sitesContainer === null ? (
          <p className="text-sm italic text-[color:var(--ink-faint)]">
            (no <code className="kbd">public/sites/</code> container, or not
            readable)
          </p>
        ) : sitesFromPod.length === 0 ? (
          <p className="text-sm italic text-[color:var(--ink-faint)]">
            (container is empty)
          </p>
        ) : (
          <ul
            className="space-y-1 text-sm"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {sitesFromPod.map((name) => (
              <li key={name}>
                <span className="text-[color:var(--accent)]">·</span>{" "}
                <a
                  className="link"
                  href={`${podRoot}public/sites/${name}/index.html`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {name}/
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <hr className="hairline my-10" />

      <Section title="Raw profile">
        <p className="mb-2 text-sm text-[color:var(--ink-soft)]">
          Verbatim Turtle returned by{" "}
          <code className="kbd">GET {profile.document}</code> with{" "}
          <code className="kbd">Accept: text/turtle</code>. Nothing on this page
          is sourced from anywhere else.
        </p>
        <pre className="codeblock">{profile.rawTurtle.trim() || "(empty)"}</pre>
      </Section>

      <hr className="hairline my-10" />

      <p
        className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        // this profile was fetched server-side, refreshed on every page load.
        nothing is cached, nothing is stored on the bridge.
      </p>
    </article>
  );
}

function DataRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]">
        {label}
      </dt>
      <dd className="break-words text-[color:var(--ink-soft)]">{children}</dd>
    </>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return (
    <span className="italic text-[color:var(--ink-faint)]">
      no {children} in profile
    </span>
  );
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

function shorten(uri: string): string {
  return uri
    .replace("http://xmlns.com/foaf/0.1/", "foaf:")
    .replace("http://www.w3.org/ns/solid/terms#", "solid:")
    .replace("http://www.w3.org/2006/vcard/ns#", "vcard:")
    .replace("http://www.w3.org/1999/02/22-rdf-syntax-ns#", "rdf:");
}

function RepoCrossRef({
  bridgeRepos,
  podRepos,
  containerExisted,
}: {
  bridgeRepos: string[];
  podRepos: string[];
  containerExisted: boolean;
}) {
  const all = Array.from(new Set([...bridgeRepos, ...podRepos])).sort();
  if (all.length === 0) {
    return (
      <p className="text-sm italic text-[color:var(--ink-faint)]">
        {containerExisted
          ? "(no repos in either source)"
          : "(no codespaces/ container — only checking the bridge)"}
      </p>
    );
  }
  return (
    <table
      className="w-full border-collapse text-sm"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]">
          <th className="py-2">repo</th>
          <th className="py-2 text-center">bridge</th>
          <th className="py-2 text-center">pod</th>
        </tr>
      </thead>
      <tbody>
        {all.map((name) => {
          const inBridge = bridgeRepos.includes(name);
          const inPod = podRepos.includes(name);
          return (
            <tr
              key={name}
              className="border-t border-[color:var(--ink-trace)]"
            >
              <td className="py-2">{name}</td>
              <td className="py-2 text-center">{inBridge ? "✓" : "—"}</td>
              <td className="py-2 text-center">{inPod ? "✓" : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ErrorPanel({
  webId,
  message,
}: {
  webId: string;
  message: string;
}) {
  return (
    <article>
      <header>
        <p className="section-mark">Profile · unreachable</p>
        <h1
          className="display mt-2 text-4xl sm:text-5xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Couldn&apos;t reach this pod.
        </h1>
        <p
          className="mt-3 text-xs text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          // tried <span className="text-[color:var(--ink-soft)]">{hostOnly(webId)}</span>
        </p>
      </header>

      <hr className="hairline my-8" />

      <div className="card">
        <p className="text-sm text-[color:var(--ink-soft)]">
          The bridge dereferenced{" "}
          <code className="kbd break-all">{webId}</code> server-side and the
          request failed. Profiles must be publicly readable to render here.
        </p>
        <pre className="codeblock mt-4">{message}</pre>
      </div>

      <p
        className="mt-8 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        // the seeded alice and mind ACLs allow public read.
        external WebIDs need the same.
      </p>
    </article>
  );
}
