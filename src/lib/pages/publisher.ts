import "server-only";
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { readBranchHead, repoPath } from "@/lib/git/backend";
import { checkoutBranchToTempDir } from "@/lib/git/checkout";
import { clip, log, scrubWebId } from "@/lib/log";
import { Metrics } from "@/lib/metrics";
import { mimeForPath } from "@/lib/pages/mime";
import { withPublishLock } from "@/lib/pages/publish-lock";
import {
  getPagesConfig,
  getRepoById,
  markPagesFailed,
  markPagesPublished,
  type PagesConfig,
  type Repo,
} from "@/lib/registry/repos";
import { ensureContainer, setPublicReadAcl } from "@/lib/solid/containers";
import {
  getOwnerFetch,
  type OwnerFetch,
  OwnerFetchUnavailableError,
} from "@/lib/solid/fetch-for-owner";

// Files / directories the publisher must NEVER upload to a pod.
// Applied during the walk, before any PUT request is sent. Symlinks of
// any kind are also skipped — see `walk` below — so that a pushed
// `evil -> /` symlink does not let the walker exfiltrate the host fs.
// See P0-S6 in PRODUCTION-READINESS.md.
const FORBIDDEN_DIRS = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".next",
  ".aws",
  ".ssh",
  ".gnupg",
]);
const FORBIDDEN_FILE_PREFIXES = [
  ".env",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
  "credentials",
  "secrets",
];
const FORBIDDEN_FILE_EXTENSIONS = new Set([".pem", ".key", ".p12", ".pfx", ".asc", ".crt"]);
const FORBIDDEN_FILE_NAMES = new Set([".DS_Store", ".netrc", ".npmrc", ".pypirc", ".dockercfg"]);

// Hard cap to keep a 5 GB asset from OOM-ing the publisher (P0-R7).
// Files above this are skipped with a warning; eventually we should
// stream PUTs instead, but this is the cheaper near-term defense.
const MAX_PUBLISH_FILE_SIZE = (() => {
  const raw = process.env.MAX_PUBLISH_FILE_SIZE;
  const n = raw ? Number(raw) : 50 * 1024 * 1024;
  return Number.isFinite(n) && n > 0 ? n : 50 * 1024 * 1024;
})();

/**
 * Legacy entrypoint: clone the branch, walk `pages.sourcePath`, upload
 * to the pod. Used when there is no workflow.yml (or the workflow runs
 * separately and does its own publish via `publishDirectory`).
 */
export async function publishPages(repoId: number): Promise<{
  uploaded: number;
  skipped: number;
  target: string;
}> {
  const repo = getRepoById(repoId);
  if (!repo) throw new Error(`repo id=${repoId} not found`);
  const pages = getPagesConfig(repoId);
  if (!pages) throw new Error(`pages config for repo id=${repoId} not found`);
  if (!pages.enabled) throw new Error(`pages not enabled for repo id=${repoId}`);
  if (!pages.targetContainer)
    throw new Error(`pages.targetContainer is empty for repo id=${repoId}`);

  const bare = repoPath(repo.owner, repo.name);

  log.info("publisher.start", {
    repo: `${repo.owner}/${repo.name}`,
    branch: pages.sourceBranch,
    mode: "legacy",
    owner: scrubWebId(repo.ownerWebId),
  });

  // Snapshot HEAD before the checkout so we can record exactly which
  // commit reached the pod. Used by the reconciler (P0-R4) to detect
  // drift when the post-receive hook silently fails.
  const headSha = await readBranchHead(repo.owner, repo.name, pages.sourceBranch);

  const { tempDir, cleanup } = await checkoutBranchToTempDir(bare, pages.sourceBranch);

  try {
    const sourceRoot = resolveSourceDir(tempDir, pages.sourcePath);
    // Serialize per-repo to avoid concurrent prune steps clobbering each
    // other's uploads. See P0-R1.
    const locked = await withPublishLock(repoId, () =>
      publishDirectory({ repo, pages, sourceDir: sourceRoot }),
    );
    if (locked === "coalesced") {
      return { uploaded: 0, skipped: 0, target: pages.targetContainer };
    }
    markPagesPublished(repoId, { sha: headSha });
    return locked;
  } finally {
    await cleanup();
  }
}

/**
 * Upload the contents of a directory (already on disk, e.g. the output
 * of a workflow's build step) to the repo's configured pod container.
 * Caller owns `sourceDir` (creates and cleans it up); this function
 * does not touch git.
 */
export async function publishDirectory(input: {
  repo: Repo;
  pages: PagesConfig;
  sourceDir: string;
}): Promise<{
  uploaded: number;
  skipped: number;
  pruned: number;
  target: string;
}> {
  const { repo, pages, sourceDir } = input;
  if (!pages.enabled) throw new Error(`pages not enabled for repo id=${repo.id}`);
  if (!pages.targetContainer)
    throw new Error(`pages.targetContainer is empty for repo id=${repo.id}`);

  const target = pages.targetContainer.endsWith("/")
    ? pages.targetContainer
    : pages.targetContainer + "/";

  log.info("publisher.target", {
    repo: `${repo.owner}/${repo.name}`,
    target,
  });

  let authed: OwnerFetch | null = null;
  let uploaded = 0;
  let skipped = 0;
  let pruned = 0;
  try {
    try {
      authed = await getOwnerFetch(repo.ownerWebId);
    } catch (e) {
      if (e instanceof OwnerFetchUnavailableError) {
        const status = e.reason === "needs-reauthorization" ? "needs-reauth" : "failed";
        markPagesFailed(repo.id, status, e.message);
        Metrics.publishFailed(repo.owner, repo.name, status);
      } else {
        markPagesFailed(repo.id, "failed", (e as Error).message ?? String(e));
        Metrics.publishFailed(repo.owner, repo.name, "owner-fetch");
      }
      throw e;
    }
    log.info("publisher.auth", {
      repo: `${repo.owner}/${repo.name}`,
      mode: authed.mode,
    });

    await ensureContainerPath(authed.fetch, repo.ownerPodRoot, target, repo.ownerWebId);

    // Track every relative URL we just (re-)uploaded so the prune step
    // afterwards can DELETE anything the source no longer contains.
    const kept = new Set<string>();
    for await (const filePath of walk(sourceDir)) {
      const rel = relative(sourceDir, filePath);
      const relUrl = rel.split(sep).join("/");
      const targetUrl = target + relUrl;
      const data = await readFile(filePath);
      const contentType = mimeForPath(filePath);

      const res = await authed.fetch(targetUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: new Uint8Array(data) as unknown as BodyInit,
      });
      if (!res.ok) {
        log.warn("publisher.put_failed", {
          repo: `${repo.owner}/${repo.name}`,
          path: relUrl,
          status: res.status,
          statusText: clip(res.statusText, 80),
        });
        skipped += 1;
      } else {
        uploaded += 1;
        kept.add(relUrl);
      }
    }

    // After-upload prune: walk the target container and DELETE files
    // that are no longer in the source set. Renames and removals are
    // reflected on the pod within one publish.
    pruned = await pruneStale(authed.fetch, target, "", kept);

    log.info("publisher.done", {
      repo: `${repo.owner}/${repo.name}`,
      target,
      uploaded,
      skipped,
      pruned,
    });
    Metrics.publishOk(repo.owner, repo.name);
    return { uploaded, skipped, pruned, target };
  } finally {
    try {
      await authed?.logout();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Walk an existing pod container tree and DELETE any *file* whose
 * relative URL is not in `kept`. Subcontainers are recursed into but
 * the containers themselves are left in place (Solid does not let us
 * delete a non-empty container, and an empty container is harmless).
 *
 * Returns the number of files deleted. Errors on individual deletions
 * are logged but do not abort the prune — a half-pruned tree on the
 * next push completes itself.
 */
async function pruneStale(
  fetcher: typeof fetch,
  containerUrl: string,
  relPrefix: string,
  kept: Set<string>,
): Promise<number> {
  const childRefs = await listContainerChildren(fetcher, containerUrl);
  const containerBase = containerUrl.endsWith("/") ? containerUrl : containerUrl + "/";
  let pruned = 0;
  for (const ref of childRefs) {
    if (!ref || ref === "./" || ref === ".") continue;
    // `ldp:contains` objects come back as relative slugs (`<index.html>`) on
    // some Solid servers and as absolute URLs (`<https://pod/…/index.html>`)
    // on others. Resolve to absolute, then re-derive the immediate child
    // segment RELATIVE to this container so `childRel` lines up with the
    // relative keys in `kept`. (This previously used the raw object as the
    // slug; against an absolute-URL server `childRel` became a full URL that
    // never matched `kept`, so the prune deleted every file it had just
    // uploaded and the published site came back empty.)
    const childAbsUrl = new URL(ref, containerBase).toString();
    if (childAbsUrl === containerBase) continue; // self-reference
    if (!childAbsUrl.startsWith(containerBase)) continue; // outside the tree
    const slug = childAbsUrl.slice(containerBase.length);
    if (!slug) continue;
    const childRel = relPrefix + slug;

    if (slug.endsWith("/")) {
      // Subcontainer — recurse. Trailing slash on `childRel` keeps the
      // prefix accumulating with proper separators on the next descent.
      pruned += await pruneStale(fetcher, childAbsUrl, childRel, kept);
    } else {
      if (kept.has(childRel)) continue;
      try {
        const res = await fetcher(childAbsUrl, { method: "DELETE" });
        if (res.ok) {
          pruned += 1;
          console.log(`[publisher] pruned ${childAbsUrl}`);
        } else if (res.status !== 404) {
          console.warn(`[publisher] DELETE ${childAbsUrl} failed: ${res.status} ${res.statusText}`);
        }
      } catch (e) {
        console.warn(`[publisher] DELETE ${childAbsUrl} threw:`, e);
      }
    }
  }
  return pruned;
}

/**
 * Fetch the LDP container at `containerUrl` and parse the
 * `ldp:contains` references out of its Turtle representation. Returns
 * the absolute URLs of each immediate child. Empty array if the
 * container doesn't exist yet (404).
 */
async function listContainerChildren(
  fetcher: typeof fetch,
  containerUrl: string,
): Promise<string[]> {
  const res = await fetcher(containerUrl, {
    method: "GET",
    headers: { Accept: "text/turtle" },
  });
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`GET ${containerUrl} failed during prune: ${res.status} ${res.statusText}`);
  }
  const body = await res.text();
  return parseLdpContains(body);
}

/**
 * Tiny Turtle-aware scanner for `ldp:contains` objects. Avoids the
 * regex pitfall where a naive `[^.;]+?` terminator would stop inside
 * `<index.html>` at the dot. We walk forward from each `ldp:contains`
 * occurrence, extract every `<URI>` token, and stop at `;` or `.` —
 * but only when those characters appear OUTSIDE a `<…>` token, which
 * is guaranteed because Turtle URI literals can't contain `>`.
 */
function parseLdpContains(body: string): string[] {
  const KEY = "ldp:contains";
  const urls: string[] = [];
  let cursor = 0;
  while (true) {
    const start = body.indexOf(KEY, cursor);
    if (start < 0) break;
    cursor = start + KEY.length;
    while (cursor < body.length) {
      const ch = body[cursor];
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n" || ch === ",") {
        cursor += 1;
        continue;
      }
      if (ch === "<") {
        const end = body.indexOf(">", cursor + 1);
        if (end < 0) break;
        urls.push(body.slice(cursor + 1, end));
        cursor = end + 1;
        continue;
      }
      // `;` (next predicate on same subject) or `.` (end of triple),
      // or any unexpected character: stop scanning this occurrence.
      break;
    }
  }
  return urls;
}

function resolveSourceDir(tempDir: string, sourcePath: string): string {
  // sourcePath is user-controlled in the Pages config; defend against
  // traversal. After resolving, the path must stay inside tempDir.
  const normalisedSrc = sourcePath.replace(/^\/+/, "");
  const resolved = resolve(tempDir, normalisedSrc);
  const root = tempDir.endsWith(sep) ? tempDir : tempDir + sep;
  if (resolved !== tempDir && !resolved.startsWith(root)) {
    throw new Error(`pages.sourcePath escapes the checkout: ${sourcePath}`);
  }
  return resolved;
}

/**
 * Walk from the pod root down to the target container, creating each
 * intermediate container along the way. The first segment is usually
 * `public` — if so, also set a public-read default ACL on it so the
 * eventually-published files are world-readable.
 */
async function ensureContainerPath(
  fetcher: typeof fetch,
  podRoot: string,
  target: string,
  ownerWebId: string,
): Promise<void> {
  if (!target.startsWith(podRoot)) {
    throw new Error(`targetContainer (${target}) is not inside ownerPodRoot (${podRoot})`);
  }
  const trail = target.slice(podRoot.length).split("/").filter(Boolean);
  let cursor = podRoot.endsWith("/") ? podRoot : podRoot + "/";
  for (let i = 0; i < trail.length; i++) {
    const segment = trail[i];
    cursor = `${cursor}${segment}/`;
    await ensureContainer(fetcher, cursor);
    if (i === 0 && segment === "public") {
      await setPublicReadAcl(fetcher, cursor, ownerWebId);
    }
  }
}

export async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    // Use lstat so we DON'T follow symlinks. The previous isDirectory() /
    // isFile() calls on the dirent follow symlinks transparently, which
    // means a pushed `evil -> /` symlink would let the walker descend
    // into the host root. P0-S6.
    let stat;
    try {
      stat = await lstat(full);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      console.warn(`[publisher] skipping symlink ${full}`);
      continue;
    }
    if (stat.isDirectory()) {
      if (FORBIDDEN_DIRS.has(entry.name)) continue;
      yield* walk(full);
      continue;
    }
    if (!stat.isFile()) continue;
    if (FORBIDDEN_FILE_NAMES.has(entry.name)) continue;
    if (FORBIDDEN_FILE_PREFIXES.some((p) => entry.name.startsWith(p))) continue;
    if (FORBIDDEN_FILE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      console.warn(`[publisher] skipping ${full} (forbidden extension)`);
      continue;
    }
    if (stat.size > MAX_PUBLISH_FILE_SIZE) {
      console.warn(
        `[publisher] skipping ${full} (size ${stat.size} > MAX_PUBLISH_FILE_SIZE ${MAX_PUBLISH_FILE_SIZE})`,
      );
      continue;
    }
    yield full;
  }
}
