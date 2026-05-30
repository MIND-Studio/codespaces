/**
 * Pod-derived avatar circle. We have no avatar images for commenters
 * (the bridge doesn't fetch the foaf:img of every commenter on every
 * render), so this component renders a deterministic colour wheel +
 * 1–2 letter initials derived from the WebID. Two flavours:
 *
 *   <Avatar webId="http://localhost:3011/alice/profile/card#me" />
 *   <Avatar agent />   — the "coder" agent badge, distinct from humans
 *
 * Sizes: "sm" (24px) for inline pills, "md" (32px) for comment headers,
 * "lg" (48px) for the issue body header.
 */

type Size = "sm" | "md" | "lg";

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-[11px]",
  lg: "h-12 w-12 text-base",
};

export function Avatar({
  webId,
  agent,
  size = "md",
  title,
}: {
  webId?: string | null;
  agent?: boolean;
  size?: Size;
  title?: string;
}) {
  if (agent) {
    return (
      <div
        aria-hidden
        title={title ?? "coder agent"}
        className={`flex shrink-0 items-center justify-center rounded-full border ${SIZE_CLASS[size]}`}
        style={{
          fontFamily: "var(--font-mono-src)",
          borderColor: "var(--accent)",
          background: "color-mix(in srgb, var(--accent) 12%, transparent)",
          color: "var(--accent)",
          letterSpacing: "0.04em",
        }}
      >
        ⌬
      </div>
    );
  }

  const display = deriveLabel(webId ?? null);
  const hue = hashHue(webId ?? display.handle);
  return (
    <div
      aria-hidden
      title={title ?? webId ?? undefined}
      className={`flex shrink-0 items-center justify-center rounded-full border border-[color:var(--ink-trace)] ${SIZE_CLASS[size]}`}
      style={{
        fontFamily: "var(--font-display)",
        background: `color-mix(in srgb, hsl(${hue} 60% 55%) 22%, var(--paper-soft))`,
        color: `color-mix(in srgb, hsl(${hue} 70% 35%) 90%, var(--ink))`,
      }}
    >
      {display.initials}
    </div>
  );
}

export function deriveLabel(webId: string | null): {
  initials: string;
  handle: string;
} {
  if (!webId) return { initials: "??", handle: "unknown" };
  try {
    const u = new URL(webId);
    // Pod-rooted WebIDs typically live under /<handle>/profile/card#me;
    // the first path segment is a stable human-readable handle.
    const seg = u.pathname.split("/").filter(Boolean)[0];
    const handle = seg && seg !== "profile" ? seg : u.host.split(".")[0];
    return { initials: toInitials(handle), handle };
  } catch {
    return { initials: toInitials(webId), handle: webId };
  }
}

function toInitials(raw: string): string {
  const cleaned = raw.replace(/[^a-z0-9-]/gi, " ").trim();
  if (!cleaned) return "??";
  const parts = cleaned.split(/[\s-]+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// FNV-ish hash → hue [0, 360). Stable across renders, no crypto needed.
function hashHue(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h % 360;
}
