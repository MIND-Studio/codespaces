import "server-only";
import { getRepo, getPagesConfig } from "@/lib/registry/repos";
import { countIssuesByStatus } from "@/lib/registry/issues";
import { countOpenPullRequests } from "@/lib/registry/pulls";
import { listPackages } from "@/lib/packages/store";
import { readSession } from "@/lib/auth/session";
import { NavTabs } from "./nav-tabs";

type ActiveKey = "code" | "issues" | "pulls" | "runs" | "packages" | "settings";

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

  const issueCounts = countIssuesByStatus(repo.id);
  const openPullCount = countOpenPullRequests(repo.id);

  // Distinct published artifacts, counting each (type, name) once — an OCI
  // image indexed by both tag and digest is one package, not two.
  const packageCount = new Set(
    listPackages(repo.id).map((p) => `${p.type}:${p.name}`),
  ).size;

  const pages = getPagesConfig(repo.id);
  const publishedUrl =
    pages && pages.enabled && pages.targetContainer
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
          count: issueCounts.open,
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
