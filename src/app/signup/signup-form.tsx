"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [podName, setPodName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, podName }),
      });
      const data = (await res.json()) as {
        error?: string;
        connectUrl?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error ?? `signup failed (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      // Successful: hand off to /connect to complete the OIDC delegation.
      router.push(data.connectUrl ?? "/connect");
    } catch (err) {
      setError((err as Error).message ?? "signup failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-md">
      <label className="block text-sm">
        <span className="block text-[color:var(--ink-soft)] mb-1">Email</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-[color:var(--ink-faint)] bg-transparent px-3 py-2"
          autoComplete="email"
        />
      </label>
      <label className="block text-sm">
        <span className="block text-[color:var(--ink-soft)] mb-1">
          Password (≥8 chars)
        </span>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-[color:var(--ink-faint)] bg-transparent px-3 py-2"
          autoComplete="new-password"
        />
      </label>
      <label className="block text-sm">
        <span className="block text-[color:var(--ink-soft)] mb-1">
          Pod name (URL slug; lower-case, alphanumeric)
        </span>
        <input
          type="text"
          required
          pattern="[a-z0-9][-a-z0-9._]{0,63}"
          value={podName}
          onChange={(e) => setPodName(e.target.value)}
          className="w-full rounded border border-[color:var(--ink-faint)] bg-transparent px-3 py-2"
          autoComplete="off"
        />
      </label>
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded border border-[color:var(--ink)] px-4 py-2 text-sm disabled:opacity-50"
      >
        {busy ? "Creating pod…" : "Create pod"}
      </button>
    </form>
  );
}
