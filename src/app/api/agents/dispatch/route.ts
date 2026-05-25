import { NextResponse } from "next/server";
import { ensureAgentsBootstrap } from "@/lib/agents/bootstrap";
import { dispatch } from "@/lib/agents/dispatch";
import type { AgentEvent } from "@/lib/agents/types";
import { getRepo } from "@/lib/registry/repos";
import { requireOwner } from "@/lib/auth/session";
import { rateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import {
  assertCanDispatchRun,
  QuotaExceededError,
} from "@/lib/registry/quotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual dispatch endpoint. Hand-fire an event and see which roles
 * respond. Useful for exercising the scaffold without git pushes or
 * cron ticks.
 *
 *   POST /api/agents/dispatch
 *   { "type": "issue.created", "repoOwner": "alice", "repoName": "bakery", "issueNumber": 1 }
 *
 * For events that reference an existing repo (and optionally an issue),
 * each fired role is persisted to `agent_runs` by the dispatcher itself
 * (opened as `running` before the driver call, closed with the final
 * status on return) so the issue's "Agent activity" panel can tail the
 * run live.
 */
export async function POST(req: Request) {
  const limited = await rateLimit("agentDispatch", RATE_LIMITS.agentDispatch);
  if (limited) return limited;
  ensureAgentsBootstrap();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const event = parseEvent(body);
  if ("error" in event) {
    return NextResponse.json({ error: event.error }, { status: 400 });
  }

  // Authenticate: agent dispatch consumes the operator's OpenRouter
  // budget and can write code into the repo. Only the repo owner may
  // trigger it. P0-S1 + the §3.5 prompt-injection mitigation: an
  // unauthenticated dispatch endpoint is what closes the
  // poisoned-issue → engineer-agent → auto-publish chain.
  const repo = getRepo(event.value.repoOwner, event.value.repoName);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const auth = await requireOwner(repo.ownerWebId);
  if (!auth.ok) return auth.response;

  try {
    assertCanDispatchRun(repo.owner);
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return NextResponse.json(
        {
          error: e.message,
          code: "QUOTA_EXCEEDED",
          quota: e.quota,
          limit: e.limit,
          observed: e.observed,
        },
        { status: 429 },
      );
    }
    throw e;
  }

  const outcomes = await dispatch(event.value);

  return NextResponse.json({ event: event.value, outcomes });
}

function parseEvent(
  raw: unknown,
): { value: AgentEvent } | { error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { error: "body must be an object" };
  }
  const o = raw as Record<string, unknown>;
  const { type, repoOwner, repoName } = o;
  if (typeof repoOwner !== "string" || typeof repoName !== "string") {
    return { error: "repoOwner and repoName are required strings" };
  }
  if (type === "issue.created") {
    if (typeof o.issueNumber !== "number") {
      return { error: "issueNumber is required for issue.created" };
    }
    return {
      value: {
        type,
        repoOwner,
        repoName,
        issueNumber: o.issueNumber,
      },
    };
  }
  if (type === "issue.labeled") {
    if (typeof o.issueNumber !== "number" || typeof o.label !== "string") {
      return { error: "issueNumber and label are required for issue.labeled" };
    }
    return {
      value: {
        type,
        repoOwner,
        repoName,
        issueNumber: o.issueNumber,
        label: o.label,
      },
    };
  }
  if (type === "manual") {
    return {
      value: {
        type,
        repoOwner,
        repoName,
        payload:
          typeof o.payload === "object" && o.payload !== null
            ? (o.payload as Record<string, unknown>)
            : undefined,
      },
    };
  }
  return { error: `unknown event type ${JSON.stringify(type)}` };
}
