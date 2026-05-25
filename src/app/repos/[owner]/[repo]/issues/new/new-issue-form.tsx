"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authedFetch } from "@/lib/auth/csrf-client";

export function NewIssueForm({ owner, repo }: { owner: string; repo: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [labels, setLabels] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await authedFetch(`/api/repos/${owner}/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify({
          title,
          body,
          priority,
          labels: labels
            .split(",")
            .map((l) => l.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `request failed: ${res.status}`);
      }
      const { issue } = (await res.json()) as { issue: { number: number } };
      router.push(`/repos/${owner}/${repo}/issues/${issue.number}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5 text-sm">
      <label className="flex flex-col gap-1.5">
        <span
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Title
        </span>
        <input
          type="text"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="One-line summary of the issue"
          className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)] disabled:opacity-50"
          style={{ fontFamily: "var(--font-mono-src)" }}
          disabled={submitting}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Body
        </span>
        <textarea
          rows={10}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Markdown welcome. Describe what should change and why."
          className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-2 leading-relaxed outline-none transition-colors focus:border-[color:var(--accent)] disabled:opacity-50"
          style={{ fontFamily: "var(--font-mono-src)" }}
          disabled={submitting}
        />
      </label>

      <div className="flex flex-wrap gap-5">
        <label className="flex flex-col gap-1.5">
          <span
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Priority
          </span>
          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as "low" | "normal" | "high")
            }
            className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)] disabled:opacity-50"
            style={{ fontFamily: "var(--font-mono-src)" }}
            disabled={submitting}
          >
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
          </select>
        </label>

        <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <span
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Labels <span className="text-[color:var(--ink-trace)]">·</span>{" "}
            comma-separated
          </span>
          <input
            type="text"
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            placeholder="bug, docs, good-first-issue"
            className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)] disabled:opacity-50"
            style={{ fontFamily: "var(--font-mono-src)" }}
            disabled={submitting}
          />
        </label>
      </div>

      {error ? (
        <p
          className="rounded border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--status-bad)",
            color: "var(--status-bad)",
            background:
              "color-mix(in srgb, var(--status-bad) 8%, transparent)",
          }}
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <button
          type="submit"
          disabled={submitting || title.trim().length === 0}
          className="rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-5 py-2 text-[color:var(--paper)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit issue"}
        </button>
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          agents fire on create ·{" "}
          <span style={{ color: "var(--ink-soft)" }}>
            triager runs immediately
          </span>
        </p>
      </div>
    </form>
  );
}
