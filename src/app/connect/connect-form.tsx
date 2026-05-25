"use client";

import { useState } from "react";
import { MatrixRain } from "@/components/matrix-rain";

type Preset = { url: string; label: string };

export function ConnectForm({
  defaultIssuer,
  presets = [],
}: {
  defaultIssuer: string;
  presets?: Preset[];
}) {
  const [issuer, setIssuer] = useState(defaultIssuer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oidcIssuer: issuer }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `start failed (${res.status})`);
      }
      const data = (await res.json()) as { redirectUrl: string };
      window.location.href = data.redirectUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
      setBusy(false);
    }
  }

  const normalized = issuer.trim().replace(/\/+$/, "");

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 text-sm">
      <label className="flex flex-col gap-1.5">
        <span
          className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Your pod&apos;s OIDC issuer URL
        </span>
        <input
          type="url"
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          placeholder="https://pod.example.com/"
          className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
          required
          disabled={busy}
        />
      </label>

      {presets.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span
            className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Common issuers
          </span>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => {
              const active =
                normalized === p.url.replace(/\/+$/, "");
              return (
                <button
                  key={p.url}
                  type="button"
                  onClick={() => setIssuer(p.url)}
                  disabled={busy}
                  className="rounded-full border px-3 py-1 text-[11px] transition-colors disabled:opacity-50"
                  style={{
                    fontFamily: "var(--font-mono-src)",
                    borderColor: active
                      ? "var(--accent)"
                      : "var(--ink-trace)",
                    background: active
                      ? "var(--accent-soft)"
                      : "var(--paper-soft)",
                    color: active ? "var(--accent-deep)" : "var(--ink-soft)",
                  }}
                  title={p.url}
                >
                  <span style={{ color: "var(--ink-faint)" }}>›</span>{" "}
                  <span>{p.url}</span>
                  <span
                    className="ml-2"
                    style={{
                      color: active
                        ? "var(--accent-deep)"
                        : "var(--ink-soft)",
                    }}
                  >
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

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
        <button
          type="submit"
          disabled={busy}
          className="rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-5 py-2 text-[color:var(--paper)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Redirecting…" : "Authorize Mind Codespaces"}
        </button>
        {busy ? (
          <MatrixRain width={108} height={28} cellSize={9} trailLength={7} />
        ) : null}
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Step 2 of 2 ·{" "}
          <span style={{ color: "var(--ink-soft)" }}>
            pod redirects back here
          </span>
        </p>
      </div>
    </form>
  );
}
