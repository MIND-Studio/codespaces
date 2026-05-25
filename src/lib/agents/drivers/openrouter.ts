import "server-only";
import type { Driver } from "@/lib/agents/types";

/**
 * OpenRouter chat-completion driver. Sends `{ system, user }` to the
 * model and returns the assistant's text as the role's summary.
 *
 * Why not opencode? opencode's SDK doesn't expose a `cwd` option on
 * `createOpencode()`, and the Triager/Scribe roles don't need file
 * tools anyway — they classify and draft text. The Engineer role,
 * which actually edits code, will get its own driver that spawns
 * `opencode serve` as a subprocess scoped to a temp checkout. That's
 * a follow-on, not v0.
 *
 * Environment:
 *   OPENROUTER_API_KEY — required to register this driver.
 *   MIND_AGENT_MODEL   — OpenRouter model id; defaults to
 *                        "anthropic/claude-3.5-sonnet".
 *
 * Note: this driver is OpenRouter-specific by design. The richer
 * coder driver consults `resolveCoderConfig(ownerWebId)` and can use
 * any configured provider (Google, Anthropic, OpenAI…) per repo
 * owner. This stub keeps the text-only fallback path simple.
 */

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type OpenRouterResponse = {
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  error?: {
    message?: string;
    code?: number;
    // OpenRouter wraps the underlying provider failure here. The
    // top-level `message` is often just "Provider returned error";
    // `metadata.raw` carries the actual reason (rate-limit text,
    // content-policy refusal, missing-model 404, etc.).
    metadata?: {
      raw?: string;
      provider_name?: string;
      retry_after_seconds?: number;
    };
  };
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

function defaultModel(): string {
  return process.env.MIND_AGENT_MODEL ?? "anthropic/claude-3.5-sonnet";
}

/** Max wall-clock seconds we'll spend honoring upstream retry-after hints. */
const MAX_RETRY_BUDGET_S = 30;
/** Max number of additional attempts after the first call. */
const MAX_RETRIES = 3;
/** Per-attempt timeout. OpenRouter has no SLA on long calls and we'd
 *  rather fail-fast than have a single role hang the whole dispatch. */
const PER_CALL_TIMEOUT_MS = 90_000;
/** Retryable upstream statuses (5xx + 429). */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

async function callOnce(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<
  | { ok: true; json: OpenRouterResponse }
  | { ok: false; status: number; json: OpenRouterResponse; networkError?: string }
> {
  const referer = process.env.BRIDGE_PUBLIC_URL ?? "http://localhost:3010";
  const title = "Mind Codespaces · agents";

  // Wall-clock cap per attempt — without this, a hung connection blocks
  // the entire dispatch budget. AbortSignal.timeout is supported on
  // Node 18+; the project requires Node 22 (see Dockerfile).
  const controller = AbortSignal.timeout(PER_CALL_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": referer,
        "X-Title": title,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 600,
        temperature: 0.3,
      }),
      signal: controller,
    });
  } catch (e) {
    // Treat fetch-level failures (timeout, DNS, TCP reset) as retryable
    // 503-equivalents so the retry path triggers.
    return {
      ok: false,
      status: 503,
      json: { error: { message: (e as Error).message } },
      networkError: (e as Error).message,
    };
  }
  const json = (await res.json().catch(() => ({}))) as OpenRouterResponse;
  if (res.ok && !json.error) return { ok: true, json };
  return { ok: false, status: res.status, json };
}

function describeError(json: OpenRouterResponse, status: number): string {
  const err = json.error;
  const parts: string[] = [];
  if (err?.code) parts.push(`code=${err.code}`);
  if (err?.metadata?.provider_name)
    parts.push(`provider=${err.metadata.provider_name}`);
  if (err?.metadata?.retry_after_seconds)
    parts.push(`retry_after=${err.metadata.retry_after_seconds}s`);
  const head = err?.message ?? `${status} request failed`;
  const tail = err?.metadata?.raw ? ` — ${err.metadata.raw}` : "";
  const suffix = parts.length > 0 ? ` [${parts.join(" ")}]` : "";
  return `${head}${suffix}${tail}`;
}

async function callOpenRouter(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
): Promise<{ text: string; usage?: OpenRouterResponse["usage"] }> {
  let budgetUsed = 0;
  let lastErr: { status: number; json: OpenRouterResponse } | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await callOnce(apiKey, model, messages);
    if (result.ok) {
      const text = result.json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("OpenRouter returned no message content");
      return { text, usage: result.json.usage };
    }

    lastErr = { status: result.status, json: result.json };

    // Retry on rate-limit (429) AND transient upstream failures (5xx /
    // network errors). Honor the upstream retry-after hint when present;
    // otherwise apply exponential backoff with jitter.
    if (!RETRYABLE_STATUSES.has(result.status) || attempt === MAX_RETRIES) break;

    const remaining = MAX_RETRY_BUDGET_S - budgetUsed;
    if (remaining <= 0) break;
    const hinted =
      result.json.error?.metadata?.retry_after_seconds ?? null;
    // Exponential backoff: 1, 2, 4 s + 0..1s jitter; cap at remaining budget.
    const computed = Math.pow(2, attempt) + Math.random();
    const sleepS = Math.min(hinted ? hinted + 1 : computed, remaining);
    console.log(
      `[agents] openrouter retry: status=${result.status} attempt=${attempt + 1}/${MAX_RETRIES} sleep=${sleepS.toFixed(1)}s`,
    );
    await new Promise((r) => setTimeout(r, sleepS * 1000));
    budgetUsed += sleepS;
  }

  throw new Error(
    `OpenRouter: ${describeError(lastErr!.json, lastErr!.status)}`,
  );
}

export const openrouterDriver: Driver = {
  name: "openrouter",
  describe() {
    return `OpenRouter chat-completion. model=${defaultModel()} (override with MIND_AGENT_MODEL).`;
  },
  async run(ctx) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      // Belt-and-braces — bootstrap shouldn't register this driver
      // without a key, but make the error obvious if it slips through.
      return {
        status: "error",
        summary: "OPENROUTER_API_KEY is not set",
        error: "missing env",
      };
    }
    const model = defaultModel();

    const { text, usage } = await callOpenRouter(apiKey, model, [
      { role: "system", content: ctx.role.systemPrompt },
      { role: "user", content: ctx.prompt },
    ]);

    return {
      status: "ok",
      summary: text,
      data: { model, usage, event: ctx.event },
    };
  },
};
