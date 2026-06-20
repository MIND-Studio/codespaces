/**
 * Free-allotment gate for the coder's bridge-default ("env-fallback") LLM key
 * (pure, unit-tested). Only the company key is metered: a user running on their
 * own BYOK key (source "user-pref") never touches the ledger, and when the
 * ledger is switched off the bridge behaves exactly as before (company key,
 * unmetered).
 */

export type FallbackGate = { kind: "allow"; meter: boolean } | { kind: "blocked"; balance: number };

/**
 * Decide whether an env-fallback (company-key) coder run may proceed, and
 * whether to debit it afterward.
 *
 *  - ledger off            → allow, unmetered (today's behavior).
 *  - ledger on, spent      → blocked (tell the user to add their own key).
 *  - ledger on, has/unknown → allow, metered. (A null balance means the ledger
 *    was unreachable; we fail open and still let the run proceed.)
 */
export function gateEnvFallback(input: {
  ledgerEnabled: boolean;
  balance: number | null;
}): FallbackGate {
  if (!input.ledgerEnabled) return { kind: "allow", meter: false };
  if (input.balance !== null && input.balance <= 0) {
    return { kind: "blocked", balance: input.balance };
  }
  return { kind: "allow", meter: true };
}
