"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
  buttonVariants,
  Input,
} from "@mind-studio/ui";
import { useState } from "react";
import { authedFetch } from "@/lib/auth/csrf-client";

type TokenSummary = {
  id: number;
  label: string;
  createdAt: number;
};

export function TokenManager({
  owner,
  repo,
  initial,
}: {
  owner: string;
  repo: string;
  initial: TokenSummary[];
}) {
  const [tokens, setTokens] = useState<TokenSummary[]>(initial);
  const [label, setLabel] = useState("");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createToken(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setPlaintext(null);
    try {
      const res = await authedFetch(`/api/repos/${owner}/${repo}/tokens`, {
        method: "POST",
        body: JSON.stringify({ label }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      const data = (await res.json()) as {
        id: number;
        label: string;
        createdAt: number;
        token: string;
      };
      setTokens((prev) => [{ id: data.id, label: data.label, createdAt: data.createdAt }, ...prev]);
      setPlaintext(data.token);
      setLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/repos/${owner}/${repo}/tokens/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      setTokens((prev) => prev.filter((t) => t.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <form onSubmit={createToken} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span
            className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Label
          </span>
          <Input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. my laptop"
            disabled={busy}
            maxLength={64}
          />
        </label>
        <Button type="submit" variant="default" size="sm" disabled={busy}>
          {busy ? "…" : "Mint token"}
        </Button>
      </form>

      {error ? <p className="text-[color:var(--status-bad)]">{error}</p> : null}

      {plaintext ? (
        <div className="rounded border-l-2 border-[color:var(--accent)] bg-[color:var(--accent-soft)] p-3">
          <p
            className="text-[10px] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--font-mono-src)", color: "var(--accent-deep)" }}
          >
            Copy this token now — it is not stored in plaintext
          </p>
          <pre className="codeblock mt-2 text-[color:var(--ink)]">{plaintext}</pre>
          <p className="mt-2 text-[color:var(--ink)]">
            Push with: <code className="kbd">git push {pushUrl(plaintext, owner, repo)}</code>
          </p>
        </div>
      ) : null}

      {tokens.length === 0 ? (
        <p className="text-[color:var(--ink-soft)]">No tokens yet.</p>
      ) : (
        <ul className="divide-y divide-[color:var(--ink-trace)]">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-4 py-2">
              <div>
                <p className="text-[color:var(--ink)]">
                  {t.label || <em className="text-[color:var(--ink-faint)]">(no label)</em>}
                </p>
                <p
                  className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
                  style={{ fontFamily: "var(--font-mono-src)" }}
                >
                  #{t.id} · created {formatDate(t.createdAt)}
                </p>
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={busy}>
                    Revoke
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Revoke token #{t.id}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Revoke token #{t.id}? This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="confirm-cancel">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      data-testid="confirm-accept"
                      className={buttonVariants({ variant: "destructive" })}
                      onClick={() => revoke(t.id)}
                    >
                      Confirm
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
}

function pushUrl(token: string, owner: string, repo: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3010";
  const u = new URL(`/api/git/${owner}/${repo}.git`, origin);
  u.username = "USER";
  u.password = token;
  return u.toString();
}
