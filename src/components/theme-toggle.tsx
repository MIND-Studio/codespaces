"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useMindTheme,
} from "@mind-studio/ui";
import { useEffect, useState } from "react";
import { useBrand } from "@/components/theme-shell";

/**
 * Masthead appearance control. Two independent axes:
 *   • mode  — light / dark, owned by next-themes (useMindTheme().setMode)
 *   • brand — Mind / Neo, owned by <ThemeShell> (useBrand)
 *
 * Everything theme-dependent is gated on a `mounted` flag so the hydration
 * render matches the server (which has no resolved mode); we re-render with
 * the real values after mount. The trigger glyph reflects the live state.
 * Unicode glyphs (not lucide) keep this free of an undeclared icon dep.
 */
export function ThemeToggle() {
  const { resolvedMode, setMode } = useMindTheme();
  const { brand, setBrand } = useBrand();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const mode = mounted && resolvedMode === "dark" ? "dark" : "light";
  const glyph = !mounted ? "◐" : brand === "neo" ? "▮" : mode === "dark" ? "☾" : "☀";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Appearance"
          title="Appearance"
          data-testid="theme-toggle"
          className="text-base leading-none"
        >
          <span aria-hidden>{glyph}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v)}>
          <DropdownMenuRadioItem value="light" data-testid="mode-light">
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" data-testid="mode-dark">
            Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={brand}
          onValueChange={(v) => setBrand(v === "neo" ? "neo" : "mind")}
        >
          <DropdownMenuRadioItem value="mind" data-testid="brand-mind">
            Mind
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="neo" data-testid="brand-neo">
            Neo · terminal
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
