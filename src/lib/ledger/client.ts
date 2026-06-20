/**
 * Server-only client for the mind-node MIND ledger (operator surface), used by
 * the coder driver to meter the bridge-default LLM key against a user's free
 * allotment. The bridge holds the operator token and spends on the user's
 * behalf: it reads the balance before an env-fallback run and debits a flat
 * price after one succeeds.
 *
 * Configuration (server env):
 *   MIND_NODE_URL        e.g. https://pods.mindpods.org  (ledger base)
 *   MIND_OPERATOR_TOKEN  the mind-node SOLIDRS_ADMIN_TOKEN bearer
 *   MIND_LLM_PRICE       MIND debited per coder run (default 1)
 *
 * Unset URL/token ⇒ ledger off: no balance checks, no debits, and the coder
 * behaves exactly as before this feature.
 */

export interface LedgerConfig {
  url: string;
  token: string;
  price: number;
}

export function ledgerConfig(): LedgerConfig | null {
  const url = process.env.MIND_NODE_URL?.trim().replace(/\/$/, "");
  const token = process.env.MIND_OPERATOR_TOKEN?.trim();
  if (!url || !token) return null;
  const price = Math.max(1, Number(process.env.MIND_LLM_PRICE ?? "1") || 1);
  return { url, token, price };
}

export function ledgerEnabled(): boolean {
  return ledgerConfig() !== null;
}

export function llmPrice(): number {
  return ledgerConfig()?.price ?? 1;
}

/**
 * The caller's MIND balance, or null when it can't be determined (ledger off,
 * disabled on the node, or unreachable). Null ⇒ fail open — don't block a
 * coder run on a ledger outage.
 */
export async function getBalance(webId: string): Promise<number | null> {
  const cfg = ledgerConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.url}/.admin/tokens?owner=${encodeURIComponent(webId)}`, {
      headers: { authorization: `Bearer ${cfg.token}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { balance?: number };
    return typeof body.balance === "number" ? body.balance : null;
  } catch {
    return null;
  }
}

export type DebitResult =
  | { ok: true; balance: number }
  | { ok: false; status: number; balance: number | null };

/**
 * Debit `amount` MIND from `webId`. A 402 means the balance was already spent;
 * the run has happened, so the caller logs and continues rather than failing
 * the user after the fact.
 */
export async function debit(webId: string, amount: number, memo: string): Promise<DebitResult> {
  const cfg = ledgerConfig();
  if (!cfg) return { ok: false, status: 0, balance: null };
  try {
    const res = await fetch(`${cfg.url}/.admin/tokens/debit`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
      body: JSON.stringify({ owner: webId, amount, memo }),
    });
    const body = (await res.json().catch(() => ({}))) as { balance?: number };
    if (res.ok) return { ok: true, balance: body.balance ?? 0 };
    return { ok: false, status: res.status, balance: body.balance ?? null };
  } catch {
    return { ok: false, status: 0, balance: null };
  }
}
