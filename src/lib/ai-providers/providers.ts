/**
 * Registry of AI providers we know how to talk to. Adding a new one
 * means: append an entry here, optionally wire the env-var forwarding
 * in coder.ts, and the rest of the stack picks it up.
 *
 * The shape encodes everything the coder driver + opencode entrypoint
 * need to actually run a model:
 *   - opencodeAuthKey: the key under which opencode looks up the API
 *     credential in `~/.local/share/opencode/auth.json`.
 *   - opencodeModelPrefix: the `-m <prefix>/<model>` token opencode uses
 *     to route the request to this provider.
 *   - containerEnvNames: the env var names to set on the coder container.
 *     We set every alias because opencode/the SDK has historically picked
 *     between them.
 *   - models: a small curated dropdown. Free-text override is also
 *     allowed in the UI for users who want a model not on the list.
 */

export type ProviderName = "openrouter" | "google" | "anthropic" | "openai";

export type ModelOption = {
  /** Bare model id WITHOUT the provider prefix. */
  id: string;
  /** Human-readable label for the dropdown. */
  label: string;
  /** Optional hint shown in muted text next to the label. */
  note?: string;
};

export type ProviderSpec = {
  name: ProviderName;
  label: string;
  /** One-line description shown in the vault UI. */
  blurb: string;
  /** Where the user gets a key. Surfaced as an external link. */
  keysUrl: string;
  /** opencode `auth.json` provider key. */
  opencodeAuthKey: string;
  /** `-m <prefix>/<model>` route prefix opencode expects. */
  opencodeModelPrefix: string;
  /** Env var names to set on the coder container. */
  containerEnvNames: string[];
  /** Curated dropdown. Users can also type a custom model id. */
  models: ModelOption[];
  /** Quick visual sanity check on key shape (prefix). Empty means no check. */
  keyShapeHint: string;
};

export const PROVIDERS: ProviderSpec[] = [
  {
    name: "openrouter",
    label: "OpenRouter",
    blurb:
      "Routes to dozens of models behind one API. Good default — Gemini, Claude, GPT-4, Llama, DeepSeek all reachable from a single key.",
    keysUrl: "https://openrouter.ai/keys",
    opencodeAuthKey: "openrouter",
    opencodeModelPrefix: "openrouter",
    containerEnvNames: ["OPENROUTER_API_KEY"],
    keyShapeHint: "sk-or-…",
    models: [
      // Free tier first — these are what runs out of the box with no
      // OpenRouter credit balance. Curated against the live `:free` list
      // and filtered to models that declare tool-use support.
      {
        id: "qwen/qwen3-coder:free",
        label: "Qwen3 Coder",
        note: "Qwen · free · coder-tuned (default)",
      },
      {
        id: "deepseek/deepseek-v4-flash:free",
        label: "DeepSeek V4 Flash",
        note: "DeepSeek · free",
      },
      { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B", note: "Meta · free" },
      { id: "z-ai/glm-4.5-air:free", label: "GLM 4.5 Air", note: "Z.AI · free" },
      // Paid — pick these when your OpenRouter key has a budget set.
      { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", note: "Anthropic · paid" },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini", note: "OpenAI · paid · cheap" },
      { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "Google · paid" },
    ],
  },
  {
    name: "google",
    label: "Google · Gemini",
    blurb:
      "Direct Google AI Studio key. Lets you use the generous free Gemini tier without going through OpenRouter.",
    keysUrl: "https://aistudio.google.com/apikey",
    opencodeAuthKey: "google",
    opencodeModelPrefix: "google",
    // Set both aliases — different versions of the AI SDK look for
    // different names. Belt-and-braces.
    containerEnvNames: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    keyShapeHint: "AIza…",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", note: "paid · top quality" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", note: "fast · cheap" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", note: "free tier" },
      {
        id: "gemini-2.0-flash-thinking-exp",
        label: "Gemini 2.0 Flash Thinking",
        note: "experimental",
      },
    ],
  },
  {
    name: "anthropic",
    label: "Anthropic",
    blurb: "Direct Anthropic key for Claude. Skip the OpenRouter margin if you already have one.",
    keysUrl: "https://console.anthropic.com/settings/keys",
    opencodeAuthKey: "anthropic",
    opencodeModelPrefix: "anthropic",
    containerEnvNames: ["ANTHROPIC_API_KEY"],
    keyShapeHint: "sk-ant-…",
    models: [
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", note: "balanced" },
      { id: "claude-opus-4-1", label: "Claude Opus 4.1", note: "best · expensive" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "fast · cheap" },
      { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet", note: "legacy" },
    ],
  },
  {
    name: "openai",
    label: "OpenAI",
    blurb:
      "Direct OpenAI key for GPT-4 / 4o / o-series. Skip the OpenRouter margin if you already have one.",
    keysUrl: "https://platform.openai.com/api-keys",
    opencodeAuthKey: "openai",
    opencodeModelPrefix: "openai",
    containerEnvNames: ["OPENAI_API_KEY"],
    keyShapeHint: "sk-…",
    models: [
      { id: "gpt-4o", label: "GPT-4o", note: "balanced" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", note: "fast · cheap" },
      { id: "o1", label: "o1", note: "reasoning · expensive" },
      { id: "o1-mini", label: "o1 mini", note: "reasoning · cheap" },
    ],
  },
];

export function getProvider(name: string): ProviderSpec | null {
  return PROVIDERS.find((p) => p.name === name) ?? null;
}

export function isProviderName(value: unknown): value is ProviderName {
  return typeof value === "string" && PROVIDERS.some((p) => p.name === value);
}

/**
 * The full `-m` argument for opencode. e.g. "openrouter/google/gemini-2.5-pro"
 * or "google/gemini-2.5-pro".
 */
export function formatOpencodeModel(provider: ProviderSpec, modelId: string): string {
  return `${provider.opencodeModelPrefix}/${modelId}`;
}
