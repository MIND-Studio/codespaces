import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/session";
import { deletePreview } from "@/lib/pages/preview";
import { closePullRequest, getPullRequest } from "@/lib/registry/pulls";
import { getRepo, RegistryError } from "@/lib/registry/repos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ owner: string; repo: string; number: string }>;
};

export async function POST(_req: Request, { params }: Params) {
  const { owner, repo: name, number: rawNumber } = await params;
  const number = Number(rawNumber);
  if (!Number.isInteger(number) || number <= 0) {
    return NextResponse.json({ error: "invalid number" }, { status: 400 });
  }
  const repo = getRepo(owner, name);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;
  const pull = getPullRequest(repo.id, number);
  if (!pull) {
    return NextResponse.json({ error: "pull not found" }, { status: 404 });
  }
  try {
    const closed = closePullRequest(pull.id);
    // Tear down the PR's preview (best-effort, fire-and-forget).
    if (pull.previewStatus === "ready") {
      void deletePreview(pull).catch((err) =>
        console.warn(`[pulls.close] preview cleanup for #${pull.number} failed:`, err),
      );
    }
    return NextResponse.json({ pull: closed });
  } catch (e) {
    if (e instanceof RegistryError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}
