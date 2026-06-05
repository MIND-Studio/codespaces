"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ThemeProvider } from "@mind-studio/ui";
import { mind } from "@mind-studio/ui/themes";
import { neo } from "@/lib/theme/neo";

export type Brand = "mind" | "neo";

const BRAND_KEY = "mc:brand";

type BrandContextValue = {
  brand: Brand;
  setBrand: (brand: Brand) => void;
};

const BrandContext = createContext<BrandContextValue | null>(null);

/**
 * Hook for the brand axis (which @mind-studio/ui Theme is active). The
 * light/dark *mode* axis is owned by `useMindTheme()` (next-themes) — the two
 * are independent: you can run Mind-dark or Neo-light.
 */
export function useBrand(): BrandContextValue {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error("useBrand() must be used inside <ThemeShell>.");
  return ctx;
}

/**
 * Root theme wrapper. Holds the brand selection (Mind | Neo) and feeds the
 * matching Theme object to `@mind-studio/ui`'s `<ThemeProvider>`, which sets
 * `data-mind-theme` and injects that brand's token CSS. The mode (light/dark)
 * is delegated to next-themes inside ThemeProvider (storageKey `mc:mode`,
 * dark by default to match the bridge's long-standing look).
 *
 * Brand is browser-local (localStorage `mc:brand`), never per-WebID — a
 * display preference shouldn't cost a pod round-trip. The layout's pre-paint
 * script mirrors both axes onto <html> before first paint to dodge the
 * flash-of-wrong-theme.
 */
export function ThemeShell({ children }: { children: React.ReactNode }) {
  const [brand, setBrandState] = useState<Brand>("mind");

  // Resolve the persisted brand after mount (SSR has no localStorage). The
  // pre-paint script already set data-mind-theme, so this only reconciles
  // React state with what the DOM is already showing.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BRAND_KEY);
      if (saved === "neo" || saved === "mind") setBrandState(saved);
    } catch {
      /* localStorage may be unavailable */
    }
  }, []);

  const setBrand = useCallback((next: Brand) => {
    setBrandState(next);
    try {
      localStorage.setItem(BRAND_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ brand, setBrand }), [brand, setBrand]);

  return (
    <BrandContext.Provider value={value}>
      <ThemeProvider
        theme={brand === "neo" ? neo : mind}
        defaultTheme="dark"
        enableSystem={false}
        storageKey="mc:mode"
      >
        {children}
      </ThemeProvider>
    </BrandContext.Provider>
  );
}
