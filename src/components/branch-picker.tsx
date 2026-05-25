"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

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

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
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
      className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      branch
      <select
        id={id}
        value={current}
        onChange={onChange}
        disabled={busy}
        className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-2 py-1 text-[12px] text-[color:var(--ink)] disabled:opacity-50"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {branches.map((b) => (
          <option key={b} value={b}>
            {b}
            {b === defaultBranch ? " (default)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
