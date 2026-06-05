"use client";

import { MindLoginCard } from "@mind-studio/core";

type Preset = { url: string; label: string };

// Presets are kept in the API to preserve the existing dev UX — for now they
// flow in but the unified card hides them behind a single "use a different
// pod" disclosure. The first preset becomes the card's default issuer.
export function ConnectForm({
  defaultIssuer,
  presets: _presets = [],
}: {
  defaultIssuer: string;
  presets?: Preset[];
}) {
  return (
    <MindLoginCard
      appName="Codespaces"
      defaultIssuer={defaultIssuer}
      accent="#10b981"
      onLogin={async ({ issuer }) => {
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
      }}
    />
  );
}
