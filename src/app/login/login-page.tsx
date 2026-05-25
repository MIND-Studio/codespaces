"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";

type Tab = "login" | "register";

type Props = {
  initialTab: Tab;
  returnTo: string;
  signupEnabled: boolean;
  defaultIssuer: string;
  issuerPresets: { url: string; label: string }[];
};

const POPUP_FEATURES = "popup,width=520,height=720,resizable,scrollbars";

/**
 * Dedicated /login page. Replaces the earlier modal — easier to style,
 * theme, and reason about; no portals, no stacking-context fights with
 * the neo CRT layer. Tabs swap between Sign-in (email + password against
 * the bundled CSS, the common path) and Create-account (registers + auto-
 * signs-in via /api/signup → /api/auth/login). A collapsed advanced
 * disclosure reveals the OIDC-popup flow for external Solid pods, which
 * remains the only correct path when the bridge can't safely take the
 * password.
 */
export function LoginPage({
  initialTab,
  returnTo,
  signupEnabled,
  defaultIssuer,
  issuerPresets,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div
      className="rounded border p-6 sm:p-8"
      style={{
        borderColor: "var(--ink-trace)",
        background: "var(--paper-soft)",
      }}
    >
      <h1
        className="text-2xl uppercase tracking-[0.06em]"
        style={{
          fontFamily: "var(--font-mono-src)",
          color: "var(--ink)",
          fontWeight: 500,
        }}
      >
        {tab === "login" ? "Sign in" : "Create account"}
      </h1>

      {signupEnabled ? (
        <div
          className="mt-5 flex gap-1 rounded border p-1 text-[10px] uppercase tracking-[0.22em]"
          style={{
            borderColor: "var(--ink-trace)",
            fontFamily: "var(--font-mono-src)",
          }}
          role="tablist"
        >
          <TabButton
            active={tab === "login"}
            onClick={() => setTab("login")}
            label="Sign in"
          />
          <TabButton
            active={tab === "register"}
            onClick={() => setTab("register")}
            label="Create account"
          />
        </div>
      ) : null}

      <div className="mt-6">
        {tab === "login" ? (
          <LoginPanel
            returnTo={returnTo}
            defaultIssuer={defaultIssuer}
            issuerPresets={issuerPresets}
          />
        ) : (
          <RegisterPanel
            returnTo={returnTo}
            onSwitchToLogin={() => setTab("login")}
          />
        )}
      </div>

      <p
        className="mt-6 border-t pt-4 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{
          fontFamily: "var(--font-mono-src)",
          borderColor: "var(--ink-trace)",
        }}
      >
        <span style={{ color: "var(--accent)" }}>// </span>
        your pod runs the login screen — the bridge only sees a token.
      </p>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className="flex-1 rounded px-3 py-1.5 transition-colors"
      style={{
        background: active ? "var(--accent-soft)" : "transparent",
        color: active ? "var(--accent-deep)" : "var(--ink-soft)",
      }}
    >
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------- */
/* Login                                                                */
/* -------------------------------------------------------------------- */

function LoginPanel({
  returnTo,
  defaultIssuer,
  issuerPresets,
}: {
  returnTo: string;
  defaultIssuer: string;
  issuerPresets: { url: string; label: string }[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No oidcIssuer → server defaults to bundled CSS (POD_BASE_URL).
        body: JSON.stringify({ email, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `sign in failed (${res.status})`);
      }
      router.push(returnTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "sign in failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 text-sm">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <FieldLabel name="Email">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            disabled={busy}
            autoFocus
            className="rounded border bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)]"
            style={{ borderColor: "var(--ink-trace)" }}
          />
        </FieldLabel>
        <FieldLabel name="Password">
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={busy}
            className="rounded border bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)]"
            style={{ borderColor: "var(--ink-trace)" }}
          />
        </FieldLabel>

        {error ? <ErrorBox>{error}</ErrorBox> : null}

        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded border bg-transparent px-4 py-2 transition-colors disabled:opacity-50"
          style={{
            borderColor: "var(--accent)",
            color: "var(--accent)",
            fontFamily: "var(--font-mono-src)",
          }}
        >
          {busy ? "Signing in…" : "Sign in →"}
        </button>
      </form>

      <div className="border-t pt-3" style={{ borderColor: "var(--ink-trace)" }}>
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)] transition-colors hover:text-[color:var(--accent)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <span aria-hidden>{advancedOpen ? "▾" : "▸"}</span>
          Use a different pod
        </button>
        {advancedOpen ? (
          <div className="mt-3">
            <ExternalPodPanel
              defaultIssuer={defaultIssuer}
              issuerPresets={issuerPresets}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/* Register                                                             */
/* -------------------------------------------------------------------- */

function RegisterPanel({
  returnTo,
  onSwitchToLogin,
}: {
  returnTo: string;
  onSwitchToLogin: () => void;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [podName, setPodName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, podName }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok || data.error) {
        setError(data.error ?? `signup failed (HTTP ${res.status})`);
        setBusy(false);
        return;
      }
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const loginData = (await loginRes.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!loginRes.ok) {
        setError(
          loginData.error ??
            "account created, but auto sign-in failed — try signing in",
        );
        setBusy(false);
        return;
      }
      router.push(returnTo);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "signup failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 text-sm">
      <FieldLabel name="Email">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          disabled={busy}
          autoFocus
          className="rounded border bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)]"
          style={{ borderColor: "var(--ink-trace)" }}
        />
      </FieldLabel>
      <FieldLabel name="Password (≥8 chars)">
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          disabled={busy}
          className="rounded border bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)]"
          style={{ borderColor: "var(--ink-trace)" }}
        />
      </FieldLabel>
      <FieldLabel name="Pod handle (lower-case slug)">
        <input
          type="text"
          required
          // The CSS slug rule accepts a-z0-9 + . _ - up to 64 chars, but
          // the HTML pattern attribute is validated under the /v RegExp
          // flag in some browsers, where `{0,63}` inside a character
          // class can throw a syntax error. Loosen to a simple form;
          // strict validation lives server-side anyway.
          pattern="[a-z0-9][a-z0-9._-]*"
          maxLength={64}
          value={podName}
          onChange={(e) => setPodName(e.target.value)}
          autoComplete="off"
          disabled={busy}
          className="rounded border bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)]"
          style={{
            borderColor: "var(--ink-trace)",
            fontFamily: "var(--font-mono-src)",
          }}
        />
      </FieldLabel>

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      <button
        type="submit"
        disabled={busy}
        className="mt-1 rounded border bg-transparent px-4 py-2 transition-colors disabled:opacity-50"
        style={{
          borderColor: "var(--accent)",
          color: "var(--accent)",
          fontFamily: "var(--font-mono-src)",
        }}
      >
        {busy ? "Creating pod…" : "Create account →"}
      </button>
      <button
        type="button"
        onClick={onSwitchToLogin}
        className="text-xs text-[color:var(--ink-soft)] underline-offset-2 hover:text-[color:var(--accent)] hover:underline"
      >
        Already have a pod? Sign in instead.
      </button>
    </form>
  );
}

/* -------------------------------------------------------------------- */
/* External pod (OIDC popup) — advanced disclosure                      */
/* -------------------------------------------------------------------- */

function ExternalPodPanel({
  defaultIssuer,
  issuerPresets,
}: {
  defaultIssuer: string;
  issuerPresets: { url: string; label: string }[];
}) {
  const [issuer, setIssuer] = useState(defaultIssuer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalized = issuer.trim().replace(/\/+$/, "");

  const start = useCallback(async (issuerUrl: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oidcIssuer: issuerUrl }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `start failed (${res.status})`);
      }
      const data = (await res.json()) as { redirectUrl: string };
      const popup = window.open(data.redirectUrl, "mc-oidc", POPUP_FEATURES);
      if (!popup) {
        window.location.href = data.redirectUrl;
        return;
      }
      const tick = setInterval(() => {
        if (popup.closed) {
          clearInterval(tick);
          setBusy(false);
        }
      }, 500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
      setBusy(false);
    }
  }, []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = issuer.trim();
        if (!trimmed) return;
        const normIssuer = trimmed.endsWith("/") ? trimmed : trimmed + "/";
        void start(normIssuer);
      }}
      className="flex flex-col gap-3 text-sm"
    >
      <FieldLabel name="Your pod's OIDC issuer">
        <input
          type="url"
          value={issuer}
          onChange={(e) => setIssuer(e.target.value)}
          placeholder="https://pod.example.com/"
          className="rounded border bg-[color:var(--paper)] px-3 py-2 outline-none transition-colors focus:border-[color:var(--accent)]"
          style={{
            borderColor: "var(--ink-trace)",
            fontFamily: "var(--font-mono-src)",
          }}
          required
          disabled={busy}
        />
      </FieldLabel>

      {issuerPresets.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {issuerPresets.map((p) => {
            const active = normalized === p.url.replace(/\/+$/, "");
            return (
              <button
                key={p.url}
                type="button"
                disabled={busy}
                onClick={() => setIssuer(p.url)}
                className="rounded-full border px-2.5 py-0.5 text-[11px] disabled:opacity-50"
                style={{
                  fontFamily: "var(--font-mono-src)",
                  borderColor: active
                    ? "var(--accent)"
                    : "var(--ink-trace)",
                  background: active ? "var(--accent-soft)" : "transparent",
                  color: active ? "var(--accent-deep)" : "var(--ink-soft)",
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      ) : null}

      {error ? <ErrorBox>{error}</ErrorBox> : null}

      <button
        type="submit"
        disabled={busy}
        className="rounded border bg-transparent px-3 py-1.5 transition-colors disabled:opacity-50"
        style={{
          borderColor: "var(--ink-trace)",
          color: "var(--ink-soft)",
          fontFamily: "var(--font-mono-src)",
        }}
      >
        {busy ? "Waiting for pod…" : "Authorize via popup →"}
      </button>
      <p className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]">
        <span style={{ color: "var(--accent)" }}>// </span>
        external pods log you in at their own URL — the bridge never sees
        that password.
      </p>
    </form>
  );
}

/* -------------------------------------------------------------------- */
/* Bits                                                                 */
/* -------------------------------------------------------------------- */

function FieldLabel({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {name}
      </span>
      {children}
    </label>
  );
}

function ErrorBox({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      className="rounded border px-3 py-2 text-sm"
      style={{
        borderColor: "var(--status-bad)",
        color: "var(--status-bad)",
        background: "color-mix(in srgb, var(--status-bad) 8%, transparent)",
      }}
    >
      {children}
    </p>
  );
}
