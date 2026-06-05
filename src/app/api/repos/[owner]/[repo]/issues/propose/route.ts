import { NextResponse } from "next/server";
import { getRepo } from "@/lib/registry/repos";
import { readSession } from "@/lib/auth/session";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { postProposal } from "@/lib/solid/inbox";
import { OwnerFetchUnavailableError } from "@/lib/solid/fetch-for-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ owner: string; repo: string }> };

const MAX_TITLE = 160;
const MAX_BODY = 8000;
const MAX_CONTACT = 200;

/**
 * Public "propose an issue" endpoint. Unlike `POST .../mind-issues` (owner
 * only), this accepts a proposal from **anyone** — including unauthenticated
 * visitors — and drops it as a Linked Data Notification into the owner's pod
 * inbox (`{podRoot}/codespaces/{repo}/inbox/`). The owner later accepts it
 * (minting a `.mind` issue at needs-triage) or dismisses it; nothing reaches
 * the tracker until then.
 *
 * Intentionally unauthenticated, so the `X-CSRF-Token` guard does NOT apply
 * here. Abuse control is the `proposalCreate` rate-limiter (per IP) + the
 * size caps below + the per-repo `proposalsEnabled` toggle + the owner's
 * ability to dismiss. A signed-in proposer's WebID is captured as
 * provenance (`as:actor`); a body-supplied WebID is ignored to prevent
 * spoofing.
 */
export async function POST(req: Request, { params }: Params) {
  const limited = await rateLimit("proposalCreate", RATE_LIMITS.proposalCreate);
  if (limited) return limited;

  const { owner, repo: name } = await params;
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  if (!repo.proposalsEnabled) {
    return NextResponse.json(
      { error: "this repo is not accepting proposals", code: "PROPOSALS_DISABLED" },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { title, body: proposalBody, contact } = (body ?? {}) as Record<string, unknown>;

  if (typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (title.length > MAX_TITLE) {
    return NextResponse.json(
      { error: `title must be ≤ ${MAX_TITLE} characters` },
      { status: 400 },
    );
  }
  if (typeof proposalBody === "string" && proposalBody.length > MAX_BODY) {
    return NextResponse.json(
      { error: `description must be ≤ ${MAX_BODY} characters` },
      { status: 400 },
    );
  }
  if (typeof contact === "string" && contact.length > MAX_CONTACT) {
    return NextResponse.json(
      { error: `contact must be ≤ ${MAX_CONTACT} characters` },
      { status: 400 },
    );
  }

  // Provenance: trust only the session, never a body-supplied WebID.
  const session = await readSession();

  try {
    const { id } = await postProposal(repo, {
      title: title.trim(),
      body: typeof proposalBody === "string" ? proposalBody.trim() : "",
      proposerWebId: session?.webId ?? null,
      contact: typeof contact === "string" ? contact.trim() || null : null,
      createdMs: Date.now(),
    });
    return NextResponse.json({ ok: true, id }, { status: 202 });
  } catch (e) {
    if (e instanceof OwnerFetchUnavailableError) {
      // The owner's pod can't be written to right now (needs reauthorization
      // or no delegated identity). Not the proposer's fault — 503.
      return NextResponse.json(
        { error: "the owner's pod is unavailable; try again later", code: "POD_UNAVAILABLE" },
        { status: 503 },
      );
    }
    console.error("[propose] failed", e);
    return NextResponse.json({ error: "proposal failed" }, { status: 500 });
  }
}
