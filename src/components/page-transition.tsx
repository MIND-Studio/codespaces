"use client";

import { usePathname } from "next/navigation";

/**
 * Wraps the route segment and re-mounts on pathname change (key prop).
 * The CSS in globals.css targets `.mc-page-transition > * > *` with
 * staggered `mc-build-in` keyframes so each top-level section of the
 * page materializes one after another. Honors prefers-reduced-motion.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="mc-page-transition flex flex-1 flex-col">
      {children}
    </div>
  );
}
