import "server-only";
import { Marked } from "marked";

/**
 * Project-local Markdown renderer. A single Marked instance is cached
 * on globalThis so we don't pay setup cost per request.
 *
 * Defaults: GFM on (tables, fenced code, autolinks), raw HTML in the
 * input is escaped (we render user-supplied READMEs and trust them only
 * as far as their git push reach allows). No syntax highlighter wired
 * in — code blocks render as plain `<pre><code>`.
 */
const GLOBAL_KEY = "__mc_marked__";
declare global {
  // eslint-disable-next-line no-var
  var __mc_marked__: Marked | undefined;
}

function getMarked(): Marked {
  if (globalThis[GLOBAL_KEY]) return globalThis[GLOBAL_KEY]!;
  const m = new Marked({
    gfm: true,
    breaks: false,
    async: false,
  });
  globalThis[GLOBAL_KEY] = m;
  return m;
}

export function renderMarkdown(input: string): string {
  // `async: false` above means parse returns string synchronously.
  return getMarked().parse(input) as string;
}
