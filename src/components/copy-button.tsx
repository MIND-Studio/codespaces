"use client";

import { useState } from "react";

/**
 * One-shot clipboard copy with a short success indicator. Falls back
 * silently if the Clipboard API throws (e.g. an insecure context) —
 * the user can still select the adjacent text manually.
 */
export function CopyButton({
  value,
  label = "copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function trigger() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no-op — see comment above */
    }
  }

  const base =
    "text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] hover:text-[color:var(--accent)] disabled:opacity-50 cursor-pointer";

  return (
    <button
      type="button"
      onClick={trigger}
      disabled={copied}
      className={className ? `${base} ${className}` : base}
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      {copied ? "✓ copied" : label}
    </button>
  );
}
