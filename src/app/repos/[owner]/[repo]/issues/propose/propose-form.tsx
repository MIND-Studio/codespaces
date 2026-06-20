"use client";

import { Button, Input, Textarea } from "@mind-studio/ui";
import { useState } from "react";

type Props = {
  owner: string;
  repo: string;
  /** WebID of the signed-in visitor, if any — shown as the attribution. */
  proposerWebId: string | null;
};

export function ProposeForm({ owner, repo, proposerWebId }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // Public endpoint: a plain fetch, no CSRF token (anonymous submitters
      // have no session). The route is rate-limited instead.
      const res = await fetch(`/api/repos/${owner}/${repo}/issues/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim() || undefined,
          contact: proposerWebId ? undefined : contact.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 429) {
          throw new Error("Too many proposals just now — try again in a minute.");
        }
        throw new Error(data.error ?? `request failed: ${res.status}`);
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  const labelClass = "text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]";
  const mono = { fontFamily: "var(--font-mono-src)" };

  if (done) {
    return (
      <section className="card mt-6 text-sm text-[color:var(--ink-soft)]">
        <p className="display text-xl" style={{ fontFamily: "var(--font-display)" }}>
          Proposal submitted.
        </p>
        <p className="mt-2">
          It landed in <code className="kbd">{owner}</code>&apos;s pod inbox. The owner will review
          it and, if accepted, it becomes a tracked issue. Thanks for the suggestion.
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5 text-sm">
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

      <label className="flex flex-col gap-1.5">
        <span className={labelClass} style={mono}>
          Description <span className="lowercase tracking-normal">(markdown)</span>
        </span>
        <Textarea
          rows={10}
          maxLength={8000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={"What should change, and why?"}
          disabled={submitting}
        />
      </label>

      {proposerWebId ? (
        <p className={labelClass} style={mono}>
          proposing as <code>{proposerWebId}</code>
        </p>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className={labelClass} style={mono}>
            Your name or contact <span className="lowercase tracking-normal">(optional)</span>
          </span>
          <Input
            type="text"
            maxLength={200}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="so the owner can follow up — leave blank to stay anonymous"
            disabled={submitting}
          />
        </label>
      )}

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
          {submitting ? "Submitting…" : "Submit proposal"}
        </Button>
        <p className={labelClass} style={mono}>
          drops a notification in the owner&apos;s pod inbox · not a tracked issue until accepted
        </p>
      </div>
    </form>
  );
}
