import "server-only";

/**
 * Shared agent-prompt fragments. The drivers (`coder`, `codex`) build their
 * own task prompts but share these non-negotiable platform constraints so
 * the rules stay identical across backends.
 */

/**
 * The platform publishes apps as STATIC sites into a Solid pod — there is no
 * server runtime. Every backend must steer the model toward a static-export
 * build, never SSR. Append to the task prompt.
 */
export const STATIC_EXPORT_RULES = [
  "STATIC EXPORT IS MANDATORY.",
  "",
  "The platform publishes your app as a STATIC site into a Solid pod — there",
  "is no server at runtime. The build must emit static files only:",
  "  • Vite / React: keep `base: './'` in vite.config (assets resolve under a",
  "    pod sub-path) and build to `dist/`.",
  "  • Next.js: set `output: 'export'` in next.config (static `out/`). Do NOT",
  "    use SSR, request-time server components, API routes, middleware, or",
  "    `next start` — none of that can run in a pod.",
  "  • Any framework: output must be plain HTML/CSS/JS served from a static",
  "    file host — no server, no request-time backend, no env-var secrets.",
  "Never commit build output (`dist/`, `out/`, `.next/`) or `node_modules/`.",
].join("\n");
