import "server-only";

/**
 * The pluggable agents scaffold. Three nouns:
 *
 *   • Driver  — the thing that actually executes a role's prompt.
 *               (`echo` is built-in; an opencode driver lands separately.)
 *   • Role    — a named (systemPrompt, allowedTools, triggers) tuple.
 *               Roles are declarative; the driver decides what they mean.
 *   • Trigger — what causes a role to fire. v0 supports manual dispatch
 *               from API routes; cron + git-hook triggers come later.
 *
 * The agents module deliberately knows nothing about issues, git, or the
 * pod. It is just the wiring. Tools that touch those surfaces are
 * registered separately by callers that have those imports available.
 *
 * Naming: "agents" refers to these LLM-backed roles. The word "team" is
 * reserved for the (future) concept of human collaborators with project
 * access.
 */

/** Bag of context passed to drivers. The driver decides what to do with it. */
export type AgentEvent =
  | {
      type: "issue.created";
      repoOwner: string;
      repoName: string;
      issueNumber: number;
    }
  | {
      type: "issue.labeled";
      repoOwner: string;
      repoName: string;
      issueNumber: number;
      label: string;
    }
  | {
      type: "issue.commented";
      repoOwner: string;
      repoName: string;
      issueNumber: number;
      commentId: number;
    }
  | {
      type: "manual";
      repoOwner: string;
      repoName: string;
      payload?: Record<string, unknown>;
    };

export type EventType = AgentEvent["type"];

/** A trigger declares what events a role responds to. */
export type Trigger =
  | { on: "issue.created" }
  | { on: "issue.labeled"; label: string }
  | { on: "issue.commented" }
  | { on: "manual" };

export type Role = {
  name: string;
  /** Human-readable; surfaced in the dashboard. */
  summary: string;
  /** Passed to the driver as the role's system prompt. */
  systemPrompt: string;
  /**
   * Allowlist of tool names the driver may expose to this role.
   * Drivers that don't know about tools can ignore this.
   * `["*"]` means "all tools the driver offers".
   */
  allowedTools: string[];
  triggers: Trigger[];
  /**
   * Optional: pin this role to a specific driver. When unset, the
   * default driver registered with `setDefaultDriver` is used.
   */
  driver?: string;
};

export type DriverContext = {
  role: Role;
  event: AgentEvent;
  /**
   * The user prompt the driver should send to the model (or treat as the
   * task statement). Built by the dispatcher from the event.
   */
  prompt: string;
  /**
   * Absolute path to the per-run log file. Drivers that produce streaming
   * output should append it here so the UI can tail the file while the
   * run is in flight. May be null when the dispatcher could not allocate
   * a run row (e.g. unknown repo); drivers should treat null as "no
   * streaming target".
   */
  logPath: string | null;
  /**
   * The agent_runs.id this driver invocation was recorded under. Null
   * when the event referenced an unknown repo so no row could be
   * created. Drivers use this to tag any side-effect rows they create
   * (e.g. agent-authored issue comments) with the originating run.
   */
  runId: number | null;
};

export type DriverResult = {
  /** "ok" if the role completed; "error" otherwise. */
  status: "ok" | "error";
  /** Single-paragraph summary the dashboard can render. */
  summary: string;
  /** Free-form structured output for callers / future audit. */
  data?: Record<string, unknown>;
  error?: string;
};

export type Driver = {
  name: string;
  describe(): string;
  run(ctx: DriverContext): Promise<DriverResult>;
};
