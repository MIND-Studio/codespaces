"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authedFetch } from "@/lib/auth/csrf-client";
import {
  Button,
  Input,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@mind-studio/ui";

export type CategoryOption = { id: string; label: string };
export type EpicOption = { slug: string; title: string };

type Props = {
  owner: string;
  repo: string;
  categories: CategoryOption[];
  epics: EpicOption[];
};

const PRIORITIES = ["urgent", "high", "normal", "low"];

export function NewIssueForm({ owner, repo, categories, epics }: Props) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [type, setType] = useState(categories[0]?.id ?? "feature");
  const [epic, setEpic] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await authedFetch(`/api/repos/${owner}/${repo}/mind-issues`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          type,
          epic,
          priority,
          body: body.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 401) {
          throw new Error("Sign in as the repo owner to create issues.");
        }
        throw new Error(data.error ?? `request failed: ${res.status}`);
      }
      const { issue } = (await res.json()) as { issue: { number: number } };
      router.push(`/repos/${owner}/${repo}/issues/${issue.number}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const labelClass =
    "text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]";
  const mono = { fontFamily: "var(--font-mono-src)" };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5 text-sm">
      <label className="flex flex-col gap-1.5">
        <span className={labelClass} style={mono}>
          Title
        </span>
        <Input
          type="text"
          required
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Short, imperative summary"
          disabled={submitting}
        />
      </label>

      <div className="flex flex-wrap gap-5">
        <label className="flex min-w-[150px] flex-1 flex-col gap-1.5">
          <span className={labelClass} style={mono}>
            Type
          </span>
          <Select value={type} onValueChange={setType} disabled={submitting}>
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

        <label className="flex min-w-[150px] flex-1 flex-col gap-1.5">
          <span className={labelClass} style={mono}>
            Epic
          </span>
          <Select value={epic} onValueChange={setEpic} disabled={submitting}>
            <SelectTrigger style={mono}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={mono}>
              <SelectItem value="general">General (un-epic&apos;d)</SelectItem>
              {epics.map((e) => (
                <SelectItem key={e.slug} value={e.slug}>
                  {e.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex min-w-[150px] flex-1 flex-col gap-1.5">
          <span className={labelClass} style={mono}>
            Priority
          </span>
          <Select value={priority} onValueChange={setPriority} disabled={submitting}>
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
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass} style={mono}>
          Description <span className="lowercase tracking-normal">(markdown)</span>
        </span>
        <Textarea
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={"## What\n\n…\n\n## Acceptance criteria\n\n- [ ] …"}
          disabled={submitting}
        />
      </label>

      {error ? (
        <p
          className="rounded border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--status-bad)",
            color: "var(--status-bad)",
            background: "color-mix(in srgb, var(--status-bad) 8%, transparent)",
          }}
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Button type="submit" disabled={submitting || title.trim().length === 0}>
          {submitting ? "Creating…" : "Create issue"}
        </Button>
        <p className={labelClass} style={mono}>
          writes a <code>.mind</code> issue + open event · folded &amp; pushed to the repo
        </p>
      </div>
    </form>
  );
}
