import "server-only";
import { PodContentStore } from "@/lib/packages/content-store";
import type { Repo } from "@/lib/registry/repos";
import { getOwnerFetch } from "@/lib/solid/fetch-for-owner";

/**
 * Build a `PodContentStore` for a repo's owner.
 *
 *   • "write" resolves the owner's delegated (or seeded) fetch — publishing
 *     writes into the owner's pod, so it needs their authority. The caller
 *     MUST call `cleanup()` when done.
 *   • "read" uses a plain unauthenticated fetch — the CAS lives under the
 *     pod's `public/` container and is public-read, so downloads don't depend
 *     on the owner's session being alive.
 */
export async function getRepoContentStore(
  repo: Repo,
  mode: "read" | "write",
): Promise<{ store: PodContentStore; cleanup: () => Promise<void> }> {
  if (mode === "read") {
    return {
      store: new PodContentStore({
        podRoot: repo.ownerPodRoot,
        ownerWebId: repo.ownerWebId,
        fetch: globalThis.fetch,
      }),
      cleanup: async () => {},
    };
  }

  const authed = await getOwnerFetch(repo.ownerWebId);
  return {
    store: new PodContentStore({
      podRoot: repo.ownerPodRoot,
      ownerWebId: repo.ownerWebId,
      fetch: authed.fetch,
    }),
    cleanup: authed.logout,
  };
}
