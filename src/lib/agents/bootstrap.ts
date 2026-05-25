import "server-only";
import {
  registerDriver,
  registerRole,
  listRoles,
  setDefaultDriver,
} from "@/lib/agents/registry";
import { echoDriver } from "@/lib/agents/drivers/echo";
import { openrouterDriver } from "@/lib/agents/drivers/openrouter";
import { coderDriver } from "@/lib/agents/drivers/coder";

/**
 * Wire the available drivers + the demo roster. Idempotent — safe to
 * call from every route module that wants the agents to be available.
 *
 * Roster: just one role, `coder`. It reads the issue (plus any prior
 * comments), decides whether to implement or ask a clarifying question,
 * and fires the matching action. Triggers on every new issue and on
 * every non-agent comment so the conversation keeps moving.
 *
 * Driver selection:
 *   • `echo` is always registered (no key needed, deterministic) and
 *     stays as the default for any future text-only roles.
 *   • `openrouter` + `coder` register when `OPENROUTER_API_KEY` is set.
 */

let initialised = false;

export function ensureAgentsBootstrap(): void {
  if (initialised) return;
  initialised = true;

  registerDriver(echoDriver);

  if (process.env.OPENROUTER_API_KEY) {
    registerDriver(openrouterDriver);
    registerDriver(coderDriver);
    setDefaultDriver("openrouter");
    console.log(
      `[agents] openrouter driver active (model=${process.env.MIND_AGENT_MODEL ?? "anthropic/claude-3.5-sonnet"})`,
    );
    console.log(
      `[agents] coder driver active (image=${process.env.MIND_CODER_IMAGE ?? "mind-codespaces/coder:latest"})`,
    );
  } else {
    console.log("[agents] OPENROUTER_API_KEY not set — using echo driver");
  }

  if (listRoles().length > 0) return;

  registerRole({
    name: "coder",
    summary:
      "Reads the issue and any prior comments, then either implements the change on a branch (and opens a PR) or posts a clarifying question / plan as a comment.",
    systemPrompt:
      "You are the Coder. Decide whether the issue is clear enough to implement now. If yes, edit the smallest set of files needed and exit — your changes become a PR. If not, write your plan + the questions you need answered to .mind/agent-comment.md (Markdown) and exit without other file changes — it will be posted as a comment on the issue.",
    allowedTools: ["*"],
    // Fire on every newly-filed issue and on every user comment (the
    // dispatcher filters out comments the coder itself authored, so the
    // loop terminates when the coder has nothing new to ask).
    triggers: [{ on: "issue.created" }, { on: "issue.commented" }],
    driver: "coder",
  });
}
