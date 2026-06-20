import { NextResponse } from "next/server";
import { isProviderName } from "@/lib/ai-providers/providers";
import { getDecryptedApiKey, getUserAiPref, setUserAiPref } from "@/lib/ai-providers/store";
import { requireSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ pref: getUserAiPref(auth.webId) });
}

export async function PUT(req: Request) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { provider, model } = (body ?? {}) as Record<string, unknown>;

  // Both null clears the preference (falls back to env at run time).
  if (provider === null && model === null) {
    const saved = setUserAiPref(auth.webId, { provider: null, model: null });
    return NextResponse.json({ pref: saved });
  }

  if (!isProviderName(provider)) {
    return NextResponse.json(
      { error: "provider must be one of openrouter|google|anthropic|openai" },
      { status: 400 },
    );
  }
  if (typeof model !== "string" || model.trim().length === 0) {
    return NextResponse.json({ error: "model must be a non-empty string" }, { status: 400 });
  }
  // Owner must have an API key configured for the provider they pick;
  // otherwise the resolver would just fall back to env at run time,
  // which is surprising. Reject up front.
  if (!getDecryptedApiKey(auth.webId, provider)) {
    return NextResponse.json(
      {
        error: `no API key configured for ${provider} — add one before selecting it as the default`,
        code: "NO_KEY",
      },
      { status: 400 },
    );
  }

  const saved = setUserAiPref(auth.webId, {
    provider,
    model: model.trim(),
  });
  return NextResponse.json({ pref: saved });
}
