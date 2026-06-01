import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepo } from "@/lib/registry/repos";
import {
  listPackages,
  isDigestRef,
  type PackageRecord,
  type PackageType,
} from "@/lib/packages/store";
import { readSession } from "@/lib/auth/session";
import { RelativeTime } from "@/components/relative-time";
import { CopyButton } from "@/components/copy-button";
import { formatBytes } from "@/lib/format";
import { RepoTabs } from "../repo-tabs";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ owner: string; repo: string }>;
};

// One published artifact (a (type, name) pair) with its visible versions.
// `versions` excludes digest-only references — for OCI those are the same
// manifest as the tag, surfaced only so pull-by-digest resolves.
type PackageGroup = {
  type: PackageType;
  name: string;
  latest: PackageRecord;
  versions: PackageRecord[];
};

const TYPE_LABEL: Record<PackageType, string> = {
  npm: "npm",
  oci: "container images",
  file: "files",
};

export default async function PackagesPage({ params }: PageProps) {
  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) notFound();

  const session = await readSession();
  const isOwner = session?.webId === repo.ownerWebId;
  const locked = repo.visibility === "private" && !isOwner;

  const bridgeBase = process.env.BRIDGE_PUBLIC_URL ?? "http://localhost:3010";
  const groups = locked ? [] : groupPackages(listPackages(repo.id));

  // Stable display order: npm, then images, then files.
  const order: PackageType[] = ["npm", "oci", "file"];
  const byType = order
    .map((t) => ({ type: t, items: groups.filter((g) => g.type === t) }))
    .filter((s) => s.items.length > 0);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
      <p className="section-mark">
        <Link href={`/repos/${owner}/${name}`} className="link">
          ← {owner}/{name}
        </Link>
      </p>
      <h1
        className="display mt-3 text-3xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        <em>Packages</em>
      </h1>
      {!locked && groups.length > 0 ? (
        <p
          className="mt-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          {groups.length} {groups.length === 1 ? "package" : "packages"} · bytes
          live in the pod
        </p>
      ) : null}

      <RepoTabs owner={owner} name={name} active="packages" />

      {locked ? (
        <LockedState />
      ) : groups.length === 0 ? (
        <PackagesEmptyState owner={owner} name={name} />
      ) : (
        <div className="mt-8 flex flex-col gap-10">
          {byType.map((section) => (
            <section key={section.type}>
              <p className="section-mark">// {TYPE_LABEL[section.type]}</p>
              <ul className="mt-4 flex flex-col gap-2.5">
                {section.items.map((g) => (
                  <li key={`${g.type}:${g.name}`}>
                    <PackageCard
                      group={g}
                      owner={owner}
                      name={name}
                      bridgeBase={bridgeBase}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PackageCard({
  group,
  owner,
  name,
  bridgeBase,
}: {
  group: PackageGroup;
  owner: string;
  name: string;
  bridgeBase: string;
}) {
  const { latest } = group;
  const install = installHint(group, owner, name, bridgeBase);
  const extraVersions = group.versions.filter((v) => v !== latest);

  return (
    <div className="card block">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span
            className="text-[0.95rem] text-[color:var(--ink)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {group.name}
          </span>
          <span className="stamp">{group.type}</span>
          <span
            className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {latest.version}
          </span>
        </div>
        <span
          className="text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          {formatBytes(latest.sizeBytes)} · <RelativeTime ts={latest.createdAt} />
        </span>
      </div>

      {extraVersions.length > 0 ? (
        <p
          className="mt-2 text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          + {extraVersions.length} older:{" "}
          {extraVersions
            .slice(0, 6)
            .map((v) => v.version)
            .join(", ")}
          {extraVersions.length > 6 ? " …" : ""}
        </p>
      ) : null}

      {install ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <span
              className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              {install.label}
            </span>
            <CopyButton value={install.value} />
          </div>
          <pre
            className="mt-1.5 overflow-x-auto rounded-sm bg-[color:var(--paper-sunk)] p-3 text-[0.78rem] leading-relaxed text-[color:var(--ink-soft)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {install.value}
          </pre>
        </div>
      ) : null}

      <p
        className="mt-2 truncate text-[10px] tracking-[0.1em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
        title={latest.digest}
      >
        {latest.digest}
      </p>
    </div>
  );
}

/** Per-format "how do I pull this" snippet, keyed off the repo's bridge host. */
function installHint(
  group: PackageGroup,
  owner: string,
  name: string,
  bridgeBase: string,
): { label: string; value: string } | null {
  const { latest } = group;
  if (group.type === "npm") {
    const scope = group.name.startsWith("@") ? group.name.split("/")[0] : null;
    const registry = `${bridgeBase}/api/packages/npm/${owner}/${name}/`;
    const lines = scope
      ? [`# .npmrc`, `${scope}:registry=${registry}`, ``, `npm install ${group.name}`]
      : [`npm install ${group.name} --registry=${registry}`];
    return { label: "install", value: lines.join("\n") };
  }
  if (group.type === "oci") {
    const host = bridgeBase.replace(/^https?:\/\//, "");
    return {
      label: "pull",
      value: `docker pull ${host}/${owner}/${name}/${group.name}:${latest.version}`,
    };
  }
  // file
  return {
    label: "download",
    value: `curl -fsSL ${bridgeBase}/api/repos/${owner}/${name}/files/${latest.version}/${group.name} -o ${group.name}`,
  };
}

/** Collapse version rows into one entry per (type, name), newest first. */
function groupPackages(rows: PackageRecord[]): PackageGroup[] {
  const map = new Map<string, PackageRecord[]>();
  for (const r of rows) {
    const key = `${r.type}:${r.name}`;
    const arr = map.get(key);
    if (arr) arr.push(r);
    else map.set(key, [r]);
  }
  const groups: PackageGroup[] = [];
  for (const [, all] of map) {
    // Hide digest-only references from the version list; keep tags/semver.
    const versions = all.filter((r) => !isDigestRef(r.version));
    const visible = versions.length > 0 ? versions : all;
    groups.push({
      type: visible[0].type,
      name: visible[0].name,
      latest: visible[0],
      versions: visible,
    });
  }
  // Newest package first, by its latest version's publish time.
  groups.sort((a, b) => b.latest.createdAt - a.latest.createdAt);
  return groups;
}

function PackagesEmptyState({ owner, name }: { owner: string; name: string }) {
  return (
    <section className="mt-10">
      <p className="section-mark">// packages</p>
      <h2
        className="display mt-3 text-3xl text-[color:var(--ink)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Nothing <em>published</em> yet.
      </h2>
      <p className="mt-4 max-w-xl leading-relaxed text-[color:var(--ink-soft)]">
        Publish npm packages, container images, or generic files to this repo
        and they show up here — the bytes are stored in the owner&apos;s pod,
        addressed by digest. Auth reuses this repo&apos;s{" "}
        <Link href={`/repos/${owner}/${name}`} className="link">
          push tokens
        </Link>
        .
      </p>
      <p className="mt-3 max-w-xl leading-relaxed text-[color:var(--ink-soft)]">
        See{" "}
        <Link href="/how-it-works" className="link">
          how it works
        </Link>{" "}
        for the publish flows (<code className="kbd">npm publish</code>,{" "}
        <code className="kbd">docker push</code>, file upload).
      </p>
    </section>
  );
}

function LockedState() {
  return (
    <section className="mt-10">
      <p className="section-mark">// private</p>
      <h2
        className="display mt-3 text-3xl text-[color:var(--ink)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        This repo is <em>private</em>.
      </h2>
      <p className="mt-4 max-w-xl leading-relaxed text-[color:var(--ink-soft)]">
        Sign in as the owner to see its published packages.
      </p>
    </section>
  );
}
