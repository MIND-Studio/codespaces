import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import {
  listConfiguredProviders,
  getUserAiPref,
  resolveCoderConfigSummary,
} from "@/lib/ai-providers/store";
import { PROVIDERS } from "@/lib/ai-providers/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only snapshot of the caller's AI setup, for client apps (e.g. the
 * builder) that render a BYOK settings UI over the bridge's vault:
 *   - providers: which providers have a stored key (hint = last 4 chars only;
 *     the key itself never leaves the server)
 *   - pref:      the selected default (provider, model)
 *   - summary:   what the coder would actually use right now (user pref vs
 *     bridge-wide env fallback vs nothing)
 *   - catalog:   the provider registry (labels, key URLs, curated models) so
 *     clients don't have to duplicate it
 */
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    providers: listConfiguredProviders(auth.webId),
    pref: getUserAiPref(auth.webId),
    summary: resolveCoderConfigSummary(auth.webId),
    catalog: PROVIDERS.map((p) => ({
      name: p.name,
      label: p.label,
      blurb: p.blurb,
      keysUrl: p.keysUrl,
      keyShapeHint: p.keyShapeHint,
      models: p.models,
    })),
  });
}
