import { MatrixRain } from "@/components/matrix-rain";

export default function Loading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center justify-center gap-6 px-6 py-32 sm:px-10">
      <MatrixRain width={220} height={132} cellSize={12} trailLength={14} />
      <div className="flex flex-col items-center gap-1">
        <span
          className="text-[10px] uppercase tracking-[0.28em]"
          style={{
            fontFamily: "var(--font-mono-src)",
            color: "rgba(0, 255, 65, 0.85)",
            textShadow: "0 0 8px rgba(0, 255, 65, 0.55)",
          }}
        >
          // matrix · loading
        </span>
        <span
          className="text-[10px] tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          decoding pod stream
        </span>
      </div>
    </div>
  );
}
