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
import { codexDriver } from "@/lib/agents/drivers/codex";

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
 *   • `echo`   — always registered (no key needed, deterministic).
 *   • `coder`  — always registered. The driver itself is BYOK-aware:
 *                it calls `resolveCoderConfig(ownerWebId)` which checks
 *                the per-user key vault at `/profile/ai-providers` before
 *                falling back to the bridge-wide `OPENROUTER_API_KEY`. So
 *                a deployment with no env key but real BYOK users still
 *                needs this driver registered.
 *   • `openrouter` — registered only when `OPENROUTER_API_KEY` is set
 *                (this driver is env-only, not BYOK-aware). Becomes the
 *                default driver for any text-only role added later.
 */

let initialised = false;

export function ensureAgentsBootstrap(): void {
  if (initialised) return;
  initialised = true;

  registerDriver(echoDriver);
  registerDriver(coderDriver);
  console.log(
    `[agents] coder driver active (image=${process.env.MIND_CODER_IMAGE ?? "mind-codespaces/coder:latest"})`,
  );

  // codex driver (PoC): OpenAI `codex exec` as an alternate backend. Not
  // bound to any auto-triggered role — invoke it by passing `driver:"codex"`
  // to POST /api/agents/dispatch so it runs side-by-side with `coder`
  // without double-firing on the same issue event.
  registerDriver(codexDriver);
  console.log(
    `[agents] codex driver active (runtime=${process.env.MIND_CODEX_RUNTIME ?? "host"})`,
  );

  if (process.env.OPENROUTER_API_KEY) {
    registerDriver(openrouterDriver);
    setDefaultDriver("openrouter");
    console.log(
      `[agents] openrouter driver active as bridge-wide fallback (model=${process.env.MIND_AGENT_MODEL ?? "qwen/qwen3-coder:free"})`,
    );
  } else {
    console.log(
      "[agents] no bridge-wide OPENROUTER_API_KEY — coder relies on per-user BYOK keys at /profile/ai-providers",
    );
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
