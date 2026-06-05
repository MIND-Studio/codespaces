import type { Theme } from "@mind-studio/ui";

/**
 * "Neo" — the bridge's signature CRT/terminal brand, preserved from the
 * pre-Mind design as an opt-in third theme alongside the default Mind brand.
 *
 * It's expressed as a real `@mind-studio/ui` brand Theme so it flows through
 * the same `<ThemeProvider>` machinery as Mind/Ember/Arctic: `ThemeProvider`
 * sets `data-mind-theme="neo"` on <html> and injects these alias tokens as a
 * `[data-mind-theme="neo"]` (+ `.dark`) block via `themeCss`. The phosphor
 * palette below drives every `@mind-studio/ui` primitive (Button, Dialog, …)
 * AND — through the alias shim in globals.css (`--ink: var(--foreground)` etc.)
 * — every bespoke `var(--ink)`/`text-ink` class the app already uses.
 *
 * The CRT flourishes that can't be tokens (scanlines, vignette, glow, HUD
 * corner brackets, dot-grid) live in globals.css keyed on
 * `[data-mind-theme="neo"]`. Neo is intrinsically dark, so both `light` and
 * `dark` carry the same values — toggling light/dark while in neo keeps the
 * terminal look instead of bleaching it.
 */

// Phosphor-green CRT palette (matches the historical neo tokens).
const surface = {
  paper: "#000000",
  paperSoft: "#060a07",
  paperSunk: "#0a120c",
  ink: "#d6e4d8",
  inkSoft: "#8fa195",
  inkTrace: "#1c2a22",
  accent: "#00ff41",
  accentSoft: "#082a12",
  accentDeep: "#6dff8e",
  bad: "#ff3860",
};

const palette = {
  background: surface.paper,
  foreground: surface.ink,
  card: surface.paperSoft,
  "card-foreground": surface.ink,
  popover: surface.paperSunk,
  "popover-foreground": surface.ink,
  primary: surface.accent,
  "primary-foreground": surface.paper,
  secondary: surface.paperSunk,
  "secondary-foreground": surface.ink,
  muted: surface.paperSunk,
  "muted-foreground": surface.inkSoft,
  accent: surface.accentSoft,
  "accent-foreground": surface.accentDeep,
  destructive: surface.bad,
  "destructive-foreground": surface.paper,
  border: surface.inkTrace,
  input: surface.inkTrace,
  ring: surface.accent,
  "chart-1": surface.accent,
  "chart-2": surface.accentDeep,
  "chart-3": "#3ddc97",
  "chart-4": "#ffd600",
  "chart-5": "#5a6960",
  sidebar: surface.paperSoft,
  "sidebar-foreground": surface.ink,
  "sidebar-primary": surface.accent,
  "sidebar-primary-foreground": surface.paper,
  "sidebar-accent": surface.accentSoft,
  "sidebar-accent-foreground": surface.accentDeep,
  "sidebar-border": surface.inkTrace,
  "sidebar-ring": surface.accent,
};

export const neo: Theme = {
  name: "neo",
  label: "Neo",
  light: palette,
  dark: palette,
  radius: "0.25rem",
  font: {
    // The masthead loads JetBrains Mono as `--font-mono-src`; neo is a
    // terminal, so its body type is monospace end-to-end.
    sans: 'var(--font-mono-src), ui-monospace, "JetBrains Mono", Menlo, monospace',
    mono: 'var(--font-mono-src), ui-monospace, "JetBrains Mono", Menlo, monospace',
  },
};
