"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authedFetch } from "@/lib/auth/csrf-client";
import {
  Button,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@mind-studio/ui";

type Props = {
  owner: string;
  repo: string;
  id: string;
  categories: { id: string; label: string }[];
  /** False when the repo has no .mind tracker — accept would always 409. */
  canAccept?: boolean;
};

const PRIORITIES = ["urgent", "high", "normal", "low"];

export function ProposalActions({
  owner,
  repo,
  id,
  categories,
  canAccept = true,
}: Props) {
  const router = useRouter();
  const [type, setType] = useState(categories[0]?.id ?? "feature");
  const [priority, setPriority] = useState("normal");
  const [busy, setBusy] = useState<null | "accept" | "dismiss">(null);
  const [error, setError] = useState<string | null>(null);

  async function accept() {
    setError(null);
    setBusy("accept");
    try {
      const res = await authedFetch(
        `/api/repos/${owner}/${repo}/inbox/${id}/accept`,
        { method: "POST", body: JSON.stringify({ type, priority }) },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `request failed: ${res.status}`);
      }
      const { issue } = (await res.json()) as { issue: { number: number } };
      router.push(`/repos/${owner}/${repo}/issues/${issue.number}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  async function dismiss() {
    setError(null);
    setBusy("dismiss");
    try {
      const res = await authedFetch(`/api/repos/${owner}/${repo}/inbox/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `request failed: ${res.status}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(null);
    }
  }

  const labelClass =
    "text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]";
  const mono = { fontFamily: "var(--font-mono-src)" };

  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="flex min-w-[120px] flex-col gap-1.5">
        <span className={labelClass} style={mono}>
          Type
        </span>
        <Select value={type} onValueChange={setType} disabled={busy !== null}>
          <SelectTrigger style={mono}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent style={mono}>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex min-w-[120px] flex-col gap-1.5">
        <span className={labelClass} style={mono}>
          Priority
        </span>
        <Select value={priority} onValueChange={setPriority} disabled={busy !== null}>
          <SelectTrigger style={mono}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent style={mono}>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <Button
        type="button"
        onClick={accept}
        disabled={busy !== null || !canAccept}
        title={canAccept ? undefined : "Requires a .mind tracker in the repo"}
      >
        {busy === "accept" ? "Accepting…" : "Accept → todo"}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={dismiss}
        disabled={busy !== null}
        className="border border-[color:var(--ink-trace)]"
      >
        {busy === "dismiss" ? "Dismissing…" : "Dismiss"}
      </Button>
      {error ? (
        <p className="w-full text-sm" style={{ color: "var(--status-bad)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
