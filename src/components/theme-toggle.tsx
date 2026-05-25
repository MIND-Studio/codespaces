"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark" | "neo";

const ORDER: Theme[] = ["light", "dark", "neo"];

const GLYPHS: Record<Theme, string> = {
  light: "○",
  dark: "◐",
  neo: "▮",
};

function apply(theme: Theme) {
  if (theme === "light") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", theme);
  }
}

function readFromDom(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  if (t === "dark" || t === "neo") return t;
  return "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    setTheme(readFromDom());
  }, []);

  function cycle() {
    const current = theme ?? readFromDom();
    const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    apply(next);
    try {
      localStorage.setItem("mc:theme", next);
    } catch {
      /* localStorage unavailable; ignore */
    }
    setTheme(next);
  }

  const current = theme ?? "light";
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const label = `Switch to ${next} theme`;

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
      style={{ fontFamily: "var(--font-mono-src)" }}
      suppressHydrationWarning
    >
      <span aria-hidden="true" className="text-[13px] leading-none">
        {GLYPHS[next]}
      </span>
      <span>{next}</span>
    </button>
  );
}
