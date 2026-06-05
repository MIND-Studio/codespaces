"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, useMindTheme } from "@mind-studio/ui";
import { useBrand } from "@/components/theme-shell";
import { authedFetch } from "@/lib/auth/csrf-client";

/**
 * Settings panel: theme picker (mode + brand, both browser-local) and a
 * sign-out button that hits /api/auth/logout.
 *
 * Theme is intentionally browser-local, not per-WebID. Storing it on the
 * pod would tie display preferences to a network round-trip the user
 * never asked to wait for. The Settings page reflects what the browser
 * already shows.
 *
 * Two independent axes:
 *  - Mode (light/dark) is owned by `useMindTheme()` (next-themes).
 *  - Brand (Mind/Neo) is owned by `useBrand()` (ThemeShell).
 */
export function ProfileSettings() {
  const router = useRouter();
  const { resolvedMode, setMode } = useMindTheme();
  const { brand, setBrand } = useBrand();
  const [signingOut, setSigningOut] = useState(false);
  // `resolvedMode` is only correct on the client — gate the active highlight
  // on a mounted flag so SSR and the first client render agree.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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

        <p
          className="mt-4 text-[10px] uppercase tracking-[0.22em] text-muted-foreground"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Appearance
        </p>
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mounted && resolvedMode === "light" ? "default" : "outline"}
            onClick={() => setMode("light")}
          >
            Light
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mounted && resolvedMode === "dark" ? "default" : "outline"}
            onClick={() => setMode("dark")}
          >
            Dark
          </Button>
        </div>

        <p
          className="mt-4 text-[10px] uppercase tracking-[0.22em] text-muted-foreground"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Theme
        </p>
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mounted && brand === "mind" ? "default" : "outline"}
            onClick={() => setBrand("mind")}
          >
            Mind
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mounted && brand === "neo" ? "default" : "outline"}
            onClick={() => setBrand("neo")}
          >
            Neo · terminal
          </Button>
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={signOut}
          disabled={signingOut}
          className="mt-3"
        >
          {signingOut ? "Signing out…" : "Sign out of the bridge"}
        </Button>
      </div>
    </div>
  );
}
