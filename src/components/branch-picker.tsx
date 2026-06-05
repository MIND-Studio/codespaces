"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@mind-studio/ui";

/**
 * Small `<select>` for switching the displayed branch on a tree/blob
 * page. Changing the selection navigates to the current pathname with
 * `?ref=<branch>` (or no query param when the default branch is
 * selected, to keep the canonical URL clean).
 */
export function BranchPicker({
  branches,
  current,
  defaultBranch,
}: {
  branches: string[];
  current: string;
  defaultBranch: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const id = useId();

  // When `current` is a commit SHA (or any non-branch ref) we still want
  // the <select> to be controlled. Inject a synthetic option for it so
  // React doesn't warn about a value with no matching option.
  const isOnBranch = branches.includes(current);
  const looksLikeSha = !isOnBranch && /^[0-9a-f]{7,40}$/i.test(current);

  function onChange(next: string) {
    if (next === current) return;
    setBusy(true);
    const url = new URL(window.location.href);
    if (next === defaultBranch) {
      url.searchParams.delete("ref");
    } else {
      url.searchParams.set("ref", next);
    }
    router.push(`${url.pathname}${url.search}`);
  }

  return (
    <label
      htmlFor={id}
      className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      {looksLikeSha ? "at commit" : "branch"}
      <Select value={current} onValueChange={onChange} disabled={busy}>
        <SelectTrigger
          id={id}
          className="h-auto py-1 text-[12px]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent style={{ fontFamily: "var(--font-mono-src)" }}>
          {!isOnBranch ? (
            <SelectItem value={current}>
              {looksLikeSha ? `${current.slice(0, 7)} (commit)` : current}
            </SelectItem>
          ) : null}
          {branches.map((b) => (
            <SelectItem key={b} value={b}>
              {b}
              {b === defaultBranch ? " (default)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
