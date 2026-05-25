import "server-only";
import { parse as parseYaml } from "yaml";

export type Workflow = {
  run: string[];
  publish: string | null;
  timeoutMs: number;
};

const DEFAULT_TIMEOUT_S = 300;
const MAX_TIMEOUT_S = 1800;

export class WorkflowParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowParseError";
  }
}

/**
 * Parse a `.mind/workflow.yml` source string into a normalised
 * `Workflow`. Throws `WorkflowParseError` with a human-readable message
 * for any schema violation; the runner surfaces those to the dashboard's
 * "Latest build" panel verbatim.
 *
 * Schema is intentionally narrow for step 1. Any unknown top-level key
 * is rejected — preferring loud failure over silently-ignored config.
 */
export function parseWorkflow(source: string): Workflow {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (e) {
    throw new WorkflowParseError(
      `invalid YAML: ${(e as Error).message ?? "parse error"}`,
    );
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new WorkflowParseError("workflow root must be a mapping");
  }
  const obj = raw as Record<string, unknown>;

  const allowed = new Set(["run", "publish", "timeout"]);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new WorkflowParseError(
        `unknown key: ${JSON.stringify(key)} (allowed: ${[...allowed].join(", ")})`,
      );
    }
  }

  // run: must be a non-empty array of non-empty strings.
  if (!Array.isArray(obj.run) || obj.run.length === 0) {
    throw new WorkflowParseError("`run` must be a non-empty array of commands");
  }
  const run: string[] = [];
  for (const [i, cmd] of obj.run.entries()) {
    if (typeof cmd !== "string" || !cmd.trim()) {
      throw new WorkflowParseError(
        `run[${i}] must be a non-empty string`,
      );
    }
    run.push(cmd);
  }

  // publish: optional, relative path without ".." or leading "/".
  let publish: string | null = null;
  if (obj.publish !== undefined) {
    if (typeof obj.publish !== "string" || !obj.publish.trim()) {
      throw new WorkflowParseError("`publish` must be a non-empty string");
    }
    const p = obj.publish.trim();
    if (p.startsWith("/")) {
      throw new WorkflowParseError("`publish` must be a relative path");
    }
    if (p.split("/").some((seg) => seg === "..")) {
      throw new WorkflowParseError("`publish` must not contain '..'");
    }
    publish = p;
  }

  // timeout: optional, integer seconds 1..1800.
  let timeoutS = DEFAULT_TIMEOUT_S;
  if (obj.timeout !== undefined) {
    if (
      typeof obj.timeout !== "number" ||
      !Number.isInteger(obj.timeout) ||
      obj.timeout < 1 ||
      obj.timeout > MAX_TIMEOUT_S
    ) {
      throw new WorkflowParseError(
        `\`timeout\` must be an integer between 1 and ${MAX_TIMEOUT_S}`,
      );
    }
    timeoutS = obj.timeout;
  }

  return { run, publish, timeoutMs: timeoutS * 1000 };
}
