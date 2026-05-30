import "server-only";
import * as path from "node:path";
import type { AgentEvent, DriverResult, Role } from "@/lib/agents/types";
import {
  getDefaultDriverName,
  getDriver,
  rolesForEvent,
} from "@/lib/agents/registry";
import {
  createAgentRun,
  finishAgentRun,
} from "@/lib/registry/agent-runs";
import { getRepo } from "@/lib/registry/repos";
import { getIssueByNumber } from "@/lib/registry/issues";
import { buildPreviewForPull } from "@/lib/pages/preview";
import { Metrics } from "@/lib/metrics";

/**
 * Where streamed per-run log files live. The registry stores just the
 * filename (`{runId}.log`); the directory can be relocated via
 * AGENT_LOGS_DIR without rewriting any rows.
 */
export const AGENT_LOGS_DIR =
  process.env.AGENT_LOGS_DIR ?? path.join(process.cwd(), ".agent-logs");

/**
 * Render a prompt for a role given the event. v0 is intentionally
 * boring — concatenate the structured event into a sentence the model
 * (or echo driver) can chew on. Concrete drivers can ignore this and
 * derive their own prompt from `ctx.event` if they prefer.
 */
function renderPrompt(role: Role, event: AgentEvent): string {
  const base = role.summary;
  switch (event.type) {
    case "issue.created":
      return `${base}\n\nA new issue was filed: ${event.repoOwner}/${event.repoName} #${event.issueNumber}.`;
    case "issue.labeled":
      return `${base}\n\nIssue ${event.repoOwner}/${event.repoName} #${event.issueNumber} was labeled "${event.label}".`;
    case "issue.commented":
      return `${base}\n\nA new comment was added to ${event.repoOwner}/${event.repoName} #${event.issueNumber}.`;
    case "manual":
      return `${base}\n\nManual dispatch on ${event.repoOwner}/${event.repoName}.`;
  }
}

export type DispatchOutcome = {
  /** The agent_runs.id this outcome was recorded under (null when the
   * event referenced an unknown repo so no row could be created). */
  runId: number | null;
  role: string;
  driver: string;
  result: DriverResult;
};

/**
 * Resolve all roles interested in `event` and run each via its assigned
 * driver (or the default). For each matched role the dispatcher opens
 * a `running` row in agent_runs *before* invoking the driver, hands the
 * driver the per-run log path so it can stream output to disk, then
 * closes the row with the final status when the driver returns. This
 * gives the UI something to poll while long-running drivers (like the
 * coder driver's docker call) are in flight.
 *
 * Errors raised by a driver are caught and returned as `status: "error"`
 * so one misbehaving role doesn't kill the rest of the batch.
 *
 * `opts.driver` overrides the backend for every fired role, ignoring each
 * role's own `driver` binding and the registered default. This lets a
 * caller exercise an alternate backend (e.g. `codex`) against the existing
 * `coder` role's triggers/context without registering a parallel role that
 * would double-fire on the same event. The caller is responsible for
 * validating the name is a registered driver.
 */
export async function dispatch(
  event: AgentEvent,
  opts: { driver?: string } = {},
): Promise<DispatchOutcome[]> {
  const roles = rolesForEvent(event);
  const outcomes: DispatchOutcome[] = [];

  const repo = getRepo(event.repoOwner, event.repoName);
  const issueNumber = "issueNumber" in event ? event.issueNumber : null;
  const issue =
    repo && issueNumber !== null
      ? getIssueByNumber(repo.id, issueNumber)
      : null;

  for (const role of roles) {
    const driverName = opts.driver ?? role.driver ?? getDefaultDriverName();
    if (!driverName) {
      outcomes.push({
        runId: null,
        role: role.name,
        driver: "(none)",
        result: {
          status: "error",
          summary: `no driver registered for role ${role.name}`,
          error: "no default driver",
        },
      });
      continue;
    }
    const driver = getDriver(driverName);
    if (!driver) {
      outcomes.push({
        runId: null,
        role: role.name,
        driver: driverName,
        result: {
          status: "error",
          summary: `driver ${driverName} not found`,
          error: "driver missing",
        },
      });
      continue;
    }

    const run = repo
      ? createAgentRun({
          repoId: repo.id,
          issueId: issue?.id ?? null,
          eventType: event.type,
          role: role.name,
          driver: driverName,
        })
      : null;
    const logPath =
      run?.logPath ? path.join(AGENT_LOGS_DIR, run.logPath) : null;

    let result: DriverResult;
    try {
      result = await driver.run({
        role,
        event,
        prompt: renderPrompt(role, event),
        logPath,
        runId: run?.id ?? null,
      });
    } catch (err) {
      result = {
        status: "error",
        summary: `driver ${driverName} threw while running ${role.name}`,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (run) {
      finishAgentRun(run.id, {
        status: result.status,
        summary: result.summary,
        errorMessage: result.error ?? null,
      });
    }

    Metrics.agentCall(driverName, role.name, result.status === "ok" ? "ok" : "error");

    // Auto-build a preview for any PR a driver just opened (fire-and-forget),
    // so the result is viewable before merge. Single chokepoint → covers every
    // driver. SHA-guarded inside buildPreviewForPull, so re-runs are cheap.
    if (repo && result.status === "ok") {
      const data = result.data as
        | { mode?: string; pullNumber?: number }
        | undefined;
      if (data?.mode === "pr" && typeof data.pullNumber === "number") {
        const pn = data.pullNumber;
        void buildPreviewForPull(repo.id, pn).catch((e) =>
          console.warn(`[agents] preview build for PR #${pn} did not start:`, e),
        );
      }
    }

    outcomes.push({
      runId: run?.id ?? null,
      role: role.name,
      driver: driverName,
      result,
    });
  }

  return outcomes;
}
