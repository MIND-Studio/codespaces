"use client";

import { Button } from "@mind-studio/ui";
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
    "h-auto px-1.5 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-primary";

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={trigger}
      disabled={copied}
      className={className ? `${base} ${className}` : base}
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      {copied ? "✓ copied" : label}
    </Button>
  );
}
