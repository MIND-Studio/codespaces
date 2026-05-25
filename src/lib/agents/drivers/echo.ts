import "server-only";
import type { Driver } from "@/lib/agents/types";

/**
 * Built-in no-op driver. Records what it *would* do, returns a stub
 * summary. Lets the agents scaffold ship and be tested end-to-end before
 * any LLM-backed driver (opencode, anthropic, …) is wired up.
 */
export const echoDriver: Driver = {
  name: "echo",
  describe() {
    return "Records the role + event without calling any model. Useful for testing the dispatch path.";
  },
  async run(ctx) {
    const head =
      ctx.prompt.length > 280 ? `${ctx.prompt.slice(0, 280)}…` : ctx.prompt;
    return {
      status: "ok",
      summary: `echo[${ctx.role.name}] event=${ctx.event.type} :: ${head}`,
      data: {
        event: ctx.event,
        allowedTools: ctx.role.allowedTools,
        promptChars: ctx.prompt.length,
      },
    };
  },
};
