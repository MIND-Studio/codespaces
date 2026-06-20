"use client";

import { Button, Input } from "@mind-studio/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
        <Input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full"
          autoComplete="email"
        />
      </label>
      <label className="block text-sm">
        <span className="block text-[color:var(--ink-soft)] mb-1">Password (≥8 chars)</span>
        <Input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full"
          autoComplete="new-password"
        />
      </label>
      <label className="block text-sm">
        <span className="block text-[color:var(--ink-soft)] mb-1">
          Pod name (URL slug; lower-case, alphanumeric)
        </span>
        {/* No `pattern=` — see new-repo-form.tsx for the /v-flag rationale. */}
        <Input
          type="text"
          required
          value={podName}
          onChange={(e) => setPodName(e.target.value)}
          className="w-full"
          autoComplete="off"
        />
      </label>
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" size="sm" disabled={busy}>
        {busy ? "Creating pod…" : "Create pod"}
      </Button>
    </form>
  );
}
