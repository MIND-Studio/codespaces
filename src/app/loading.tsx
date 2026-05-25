export default function Loading() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col items-center justify-center gap-2 px-6 py-32 sm:px-10">
      <span
        className="text-[10px] uppercase tracking-[0.28em] text-[color:var(--ink-soft)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        // loading
      </span>
      <span
        className="text-[10px] tracking-[0.18em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        decoding pod stream
      </span>
    </div>
  );
}
