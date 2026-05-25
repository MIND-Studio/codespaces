import "server-only";

/**
 * Per-repo serialization for publish chains. Two pushes seconds apart
 * would otherwise spawn two concurrent `publishDirectory` calls against
 * the same pod container — and the prune step is especially dangerous
 * (publish #1 can DELETE files publish #2 just wrote, because the
 * `kept` set is local to each call). See P0-R1 in PRODUCTION-READINESS.md.
 *
 * Design: latest-wins coalescing. While a publish for repo R is in
 * flight, only ONE follow-up can be queued. Any *further* incoming
 * publishes coalesce into that single follow-up: the prior follow-up's
 * caller observes "coalesced" and returns; the new caller becomes the
 * pending one. The drain at the end of the current task always runs the
 * latest pending and resolves its caller with the result.
 */

type Pending = {
  run: () => Promise<unknown>;
  // Resolver for the queued caller — runs with the task's result OR with
  // "coalesced" when this slot gets replaced by a newer follow-up.
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
};

type LockEntry = {
  current: Promise<void>;
  pending: Pending | null;
};

const locks = new Map<number, LockEntry>();

export async function withPublishLock<T>(
  repoId: number,
  task: () => Promise<T>,
): Promise<T | "coalesced"> {
  const existing = locks.get(repoId);
  if (existing) {
    // Coalesce into the pending slot. If the slot is already occupied,
    // resolve THAT prior caller with "coalesced" so it doesn't hang
    // (latest-wins).
    if (existing.pending) {
      existing.pending.resolve("coalesced");
    }
    return await new Promise<T | "coalesced">((resolve, reject) => {
      existing.pending = {
        run: async () => task(),
        resolve: resolve as (v: unknown) => void,
        reject,
      };
    });
  }

  const entry: LockEntry = { current: Promise.resolve(), pending: null };
  let initialResult: T;
  entry.current = (async () => {
    try {
      initialResult = await task();
    } finally {
      // Drain queued follow-ups. Each iteration: clear the slot, run it,
      // resolve THAT caller. If a new follow-up arrives during the run
      // it lands in the now-empty slot and we iterate again.
      while (entry.pending) {
        const slot = entry.pending;
        entry.pending = null;
        try {
          const value = await slot.run();
          slot.resolve(value);
        } catch (e) {
          slot.reject(e);
        }
      }
      locks.delete(repoId);
    }
  })();
  locks.set(repoId, entry);
  await entry.current;
  return initialResult!;
}
