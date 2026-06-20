import * as fs from "node:fs/promises";
import * as path from "node:path";
import { NextResponse } from "next/server";
import { AGENT_LOGS_DIR } from "@/lib/agents/dispatch";
import { getAgentRun } from "@/lib/registry/agent-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Tail endpoint for a per-run log file.
 *
 *   GET /api/agent-runs/{id}/log?since=<bytes>
 *
 * Returns a JSON envelope { content, size, status } where:
 *   • content   — log bytes from byte `since` to current EOF (utf-8).
 *   • size      — current file size in bytes; the client uses it as the
 *                 next `since` to fetch incremental chunks.
 *   • status    — the run's current lifecycle state, so the client knows
 *                 when to stop polling.
 *
 * Cheap and stateless; the bridge re-reads the slice on every poll.
 * Fine at prototype scale.
 */
export async function GET(req: Request, { params }: Params) {
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const run = getAgentRun(id);
  if (!run) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!run.logPath) {
    return NextResponse.json({
      content: "",
      size: 0,
      status: run.status,
      logAvailable: false,
    });
  }

  const url = new URL(req.url);
  const since = Math.max(0, Number(url.searchParams.get("since") ?? "0"));

  const abs = path.join(AGENT_LOGS_DIR, run.logPath);
  let buf: Buffer;
  let size = 0;
  try {
    const stat = await fs.stat(abs);
    size = stat.size;
    if (since >= size) {
      return NextResponse.json({
        content: "",
        size,
        status: run.status,
        logAvailable: true,
      });
    }
    const fh = await fs.open(abs, "r");
    try {
      const len = size - since;
      buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, since);
    } finally {
      await fh.close();
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({
        content: "",
        size: 0,
        status: run.status,
        logAvailable: false,
      });
    }
    throw err;
  }

  return NextResponse.json({
    content: buf.toString("utf-8"),
    size,
    status: run.status,
    logAvailable: true,
  });
}
