import Link from "next/link";
import { MatrixRain } from "@/components/matrix-rain";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16 sm:px-10">
      <p className="section-mark">// 404</p>
      <div className="mt-3 flex flex-col items-start gap-6 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
        <h1 className="display text-4xl sm:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
          Not on this <em>bridge</em>.
        </h1>
        <div className="flex flex-col items-end gap-1">
          <MatrixRain width={156} height={88} cellSize={10} trailLength={10} />
          <span
            className="text-[9px] uppercase tracking-[0.28em]"
            style={{
              fontFamily: "var(--font-mono-src)",
              color: "rgba(0, 255, 65, 0.85)",
              textShadow: "0 0 6px rgba(0, 255, 65, 0.5)",
            }}
          >
            // signal lost
          </span>
        </div>
      </div>
      <p className="mt-5 max-w-2xl leading-relaxed text-[color:var(--ink-soft)]">
        That URL doesn&apos;t resolve to anything the bridge knows about. The repo, run, pull, or
        page may have been renamed, never existed, or lives on a different Solid Pod entirely.
      </p>

      <hr className="hairline my-10" />

      <p
        className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        try one of these
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        <li>
          <Link href="/repos" className="link">
            Browse all repos
          </Link>
          <span className="ml-2 text-sm text-[color:var(--ink-faint)]">
            — every repository registered with this bridge
          </span>
        </li>
        <li>
          <Link href="/" className="link">
            Back to the landing page
          </Link>
          <span className="ml-2 text-sm text-[color:var(--ink-faint)]">
            — what this prototype is, and the quickstart
          </span>
        </li>
        <li>
          <Link href="/how-it-works" className="link">
            How it works
          </Link>
          <span className="ml-2 text-sm text-[color:var(--ink-faint)]">
            — the architecture in one read
          </span>
        </li>
      </ul>
    </div>
  );
}
