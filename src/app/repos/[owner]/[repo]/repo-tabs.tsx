import "server-only";
import { getRepo, getPagesConfig } from "@/lib/registry/repos";
import { readRepoTracker } from "@/lib/tracker/source";
import { countOpenPullRequests } from "@/lib/registry/pulls";
import { listPackages } from "@/lib/packages/store";
import { readSession } from "@/lib/auth/session";
import { NavTabs } from "./nav-tabs";

type ActiveKey =
  | "code"
  | "issues"
  | "pulls"
  | "runs"
  | "packages"
  | "proposals"
  | "settings";

export async function RepoTabs({
  owner,
  name,
  active,
}: {
  owner: string;
  name: string;
  active: ActiveKey;
}) {
  const repo = getRepo(owner, name);
  if (!repo) return null;

  const session = await readSession();
  const isOwner = session?.webId === repo.ownerWebId;

  // Open-issue badge reflects the repo's .mind tracker (the same source the
  // /issues board renders, pod-first), so the tab count matches the board.
  const tracker = await readRepoTracker(repo, owner, name);
  const openIssueCount = tracker
    ? tracker.issues.filter((i) => i.open).length
    : 0;
  const openPullCount = countOpenPullRequests(repo.id);

  // Distinct published artifacts, counting each (type, name) once — an OCI
  // image indexed by both tag and digest is one package, not two.
  const packageCount = new Set(
    listPackages(repo.id).map((p) => `${p.type}:${p.name}`),
  ).size;

  const pages = getPagesConfig(repo.id);
  // "Live site" only once a publish actually landed — enabled-but-unpublished
  // pages would link to a 404 on the pod.
  const publishedUrl =
    pages && pages.enabled && pages.targetContainer && pages.lastPublishedAt
      ? pages.targetContainer.replace(/\/?$/, "/") + "index.html"
      : null;

  return (
    <NavTabs
      tabs={[
        {
          key: "code",
          href: `/repos/${owner}/${name}`,
          label: "Code",
          active: active === "code",
        },
        {
          key: "issues",
          href: `/repos/${owner}/${name}/issues`,
          label: "Issues",
          count: openIssueCount,
          active: active === "issues",
        },
        {
          key: "pulls",
          href: `/repos/${owner}/${name}/pulls`,
          label: "Pulls",
          count: openPullCount,
          active: active === "pulls",
        },
        {
          key: "runs",
          href: `/repos/${owner}/${name}/runs`,
          label: "Runs",
          active: active === "runs",
        },
        {
          key: "packages",
          href: `/repos/${owner}/${name}/packages`,
          label: "Packages",
          count: packageCount,
          active: active === "packages",
        },
        ...(isOwner
          ? [
              // Owner-only. No count: reading the count means a pod round-trip,
              // and this tab renders on every repo subpage — the Proposals page
              // itself shows the inbox size.
              {
                key: "proposals",
                href: `/repos/${owner}/${name}/proposals`,
                label: "Proposals",
                active: active === "proposals",
              },
              {
                key: "settings",
                href: `/repos/${owner}/${name}/settings`,
                label: "Settings",
                active: active === "settings",
              },
            ]
          : []),
        ...(publishedUrl
          ? [
              {
                key: "live",
                href: publishedUrl,
                label: "Live site",
                external: true,
              },
            ]
          : []),
      ]}
    />
  );
}
