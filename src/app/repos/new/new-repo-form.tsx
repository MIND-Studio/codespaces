"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authedFetch } from "@/lib/auth/csrf-client";

type Props = {
  owner: string;
  ownerWebId: string;
  ownerPodRoot: string;
};

export function NewRepoForm({ owner, ownerWebId, ownerPodRoot }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [defaultBranch, setDefaultBranch] = useState("main");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await authedFetch("/api/repos", {
        method: "POST",
        body: JSON.stringify({
          owner,
          name: name.trim(),
          ownerWebId,
          ownerPodRoot,
          visibility,
          defaultBranch: defaultBranch.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `request failed: ${res.status}`);
      }
      const { repo } = (await res.json()) as { repo: { owner: string; name: string } };
      router.push(`/repos/${repo.owner}/${repo.name}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5 text-sm">
      <div className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-4 py-3">
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Owner
        </p>
        <p
          className="mt-1 text-[color:var(--ink)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          {owner}
        </p>
        <p
          className="mt-2 truncate text-[11px] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
          title={ownerWebId}
        >
          {ownerWebId}
        </p>
        <p
          className="mt-0.5 truncate text-[11px] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
          title={ownerPodRoot}
        >
          pod: {ownerPodRoot}
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Repository name
        </span>
        <input
          type="text"
          required
          maxLength={64}
          pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="hello-world"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)] disabled:opacity-50"
          style={{ fontFamily: "var(--font-mono-src)" }}
          disabled={submitting}
        />
        <span
          className="text-[11px] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Letters, digits, <code>.</code> <code>_</code> <code>-</code> · must start
          with a letter or digit · max 64 chars
        </span>
      </label>

      <div className="flex flex-wrap gap-5">
        <label className="flex flex-col gap-1.5">
          <span
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Visibility
          </span>
          <select
            value={visibility}
            onChange={(e) =>
              setVisibility(e.target.value as "public" | "private")
            }
            className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)] disabled:opacity-50"
            style={{ fontFamily: "var(--font-mono-src)" }}
            disabled={submitting}
          >
            <option value="public">public</option>
            <option value="private">private (push token also required to clone)</option>
          </select>
        </label>

        <label className="flex min-w-[200px] flex-1 flex-col gap-1.5">
          <span
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Default branch
          </span>
          <input
            type="text"
            value={defaultBranch}
            onChange={(e) => setDefaultBranch(e.target.value)}
            placeholder="main"
            spellCheck={false}
            autoComplete="off"
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
          disabled={submitting || name.trim().length === 0}
          className="rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-5 py-2 text-[color:var(--paper)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create repo"}
        </button>
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          bare git repo on disk · turtle description written to your pod
        </p>
      </div>
    </form>
  );
}
