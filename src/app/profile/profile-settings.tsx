"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authedFetch } from "@/lib/auth/csrf-client";

type Theme = "light" | "dark" | "neo";

const THEMES: { value: Theme; label: string; glyph: string; hint: string }[] = [
  { value: "light", label: "Light", glyph: "○", hint: "Paper" },
  { value: "dark", label: "Dark", glyph: "◐", hint: "Night" },
  { value: "neo", label: "Neo", glyph: "▮", hint: "Terminal" },
];

function applyTheme(theme: Theme) {
  if (theme === "light") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

function readCurrentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark" || t === "neo") return t;
  return "light";
}

/**
 * Settings panel: theme picker (persists to localStorage; the layout
 * inline script applies it before first paint to avoid the flash) and a
 * sign-out button that hits /api/auth/logout.
 *
 * Theme is intentionally browser-local, not per-WebID. Storing it on the
 * pod would tie display preferences to a network round-trip the user
 * never asked to wait for. The Settings page reflects what the browser
 * already shows.
 */
export function ProfileSettings() {
  const router = useRouter();
  const [theme, setTheme] = useState<Theme | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setTheme(readCurrentTheme());
  }, []);

  function choose(next: Theme) {
    applyTheme(next);
    try {
      localStorage.setItem("mc:theme", next);
    } catch {
      /* localStorage may be unavailable */
    }
    setTheme(next);
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await authedFetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.replace("/");
      router.refresh();
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Appearance
        </p>
        <h3 className="mt-1 text-base text-[color:var(--ink)]">Theme</h3>
        <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
          Saved in this browser only — your pod doesn&apos;t see it.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {THEMES.map((t) => {
            const active = theme === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => choose(t.value)}
                className="rounded border px-3 py-2 text-left transition-colors"
                style={{
                  borderColor: active
                    ? "var(--accent)"
                    : "var(--ink-trace)",
                  background: active
                    ? "var(--accent-soft)"
                    : "var(--paper-soft)",
                  color: active
                    ? "var(--accent-deep)"
                    : "var(--ink-soft)",
                }}
              >
                <span
                  className="text-base leading-none"
                  style={{ fontFamily: "var(--font-mono-src)" }}
                  aria-hidden
                >
                  {t.glyph}
                </span>
                <span
                  className="ml-2 text-sm"
                  style={{ fontWeight: 500 }}
                >
                  {t.label}
                </span>
                <span
                  className="ml-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
                  style={{ fontFamily: "var(--font-mono-src)" }}
                >
                  {t.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Session
        </p>
        <h3 className="mt-1 text-base text-[color:var(--ink)]">Sign out</h3>
        <p className="mt-1 text-sm text-[color:var(--ink-soft)]">
          Drops the bridge&apos;s session cookie. Your pod stays connected
          for the OIDC client (revoke that from{" "}
          <a className="link" href="/identities">
            connected pods
          </a>
          ).
        </p>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="mt-3 rounded border border-[color:var(--ink-trace)] px-4 py-2 text-sm text-[color:var(--ink)] transition-colors hover:border-[color:var(--status-bad)] hover:text-[color:var(--status-bad)] disabled:opacity-50"
        >
          {signingOut ? "Signing out…" : "Sign out of the bridge"}
        </button>
      </div>
    </div>
  );
}
