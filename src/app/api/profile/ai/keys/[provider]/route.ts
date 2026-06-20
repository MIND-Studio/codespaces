import { NextResponse } from "next/server";
import { isProviderName } from "@/lib/ai-providers/providers";
import { deleteUserApiKey, setUserApiKey } from "@/lib/ai-providers/store";
import { requireSession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ provider: string }> };

export async function POST(req: Request, { params }: Params) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { provider } = await params;
  if (!isProviderName(provider)) {
    return NextResponse.json(
      { error: `unknown provider ${JSON.stringify(provider)}` },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const { apiKey } = (body ?? {}) as Record<string, unknown>;
  if (typeof apiKey !== "string" || apiKey.trim().length < 8) {
    return NextResponse.json(
      { error: "apiKey must be a string of at least 8 characters" },
      { status: 400 },
    );
  }
  // Reject obvious nonsense — keys are typically opaque ASCII tokens. We
  // don't validate prefix per-provider here (the UI hint covers that);
  // wrong-shape keys will just fail at the model call and the user will
  // see the upstream error.
  if (apiKey.length > 1000) {
    return NextResponse.json({ error: "apiKey too long" }, { status: 400 });
  }

  const saved = setUserApiKey(auth.webId, provider, apiKey);
  return NextResponse.json({ provider: saved });
}

export async function DELETE(_req: Request, { params }: Params) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  const { provider } = await params;
  if (!isProviderName(provider)) {
    return NextResponse.json(
      { error: `unknown provider ${JSON.stringify(provider)}` },
      { status: 400 },
    );
  }
  deleteUserApiKey(auth.webId, provider);
  return NextResponse.json({ ok: true });
}
