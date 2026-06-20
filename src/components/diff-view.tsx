/**
 * Colorised unified-diff renderer. Splits the patch into lines and tags
 * each with a CSS class so additions, deletions, hunk headers and file
 * headers are visually distinct. No syntax highlighting beyond that —
 * just line-level semantic colours, which is the bulk of what makes a
 * diff scannable.
 *
 * Server component on purpose (no interactivity); colours come from
 * inline classes so the dark-theme overrides in globals.css can flip
 * them via `[data-theme='dark']` selectors if/when wanted.
 */
export function DiffView({ patch, truncated }: { patch: string; truncated: boolean }) {
  const lines = patch.split("\n");
  // Drop the trailing empty line from a final newline so we don't
  // render a phantom row at the bottom.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return (
    <div className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper-sunk)] overflow-hidden min-w-0 max-w-full">
      <pre
        className="m-0 max-h-[600px] overflow-auto p-0 text-[12px] leading-relaxed max-w-full"
        style={{ fontFamily: "var(--font-mono-src)", WebkitOverflowScrolling: "touch" }}
      >
        {lines.map((line, i) => {
          const kind = classify(line);
          return (
            <div key={i} className={`px-4 whitespace-pre ${classNameFor(kind)}`}>
              {line || " "}
            </div>
          );
        })}
      </pre>
      {truncated ? (
        <div
          className="border-t border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          truncated · clone the branch to see the full patch
        </div>
      ) : null}
    </div>
  );
}

type LineKind =
  | "fileHeader"
  | "indexLine"
  | "rangeMarker"
  | "hunkHeader"
  | "addition"
  | "deletion"
  | "context"
  | "noNewline";

function classify(line: string): LineKind {
  if (line.startsWith("diff --git ")) return "fileHeader";
  if (line.startsWith("index ")) return "indexLine";
  if (line.startsWith("+++ ") || line.startsWith("--- ")) return "rangeMarker";
  if (line.startsWith("@@")) return "hunkHeader";
  if (line.startsWith("\\ ")) return "noNewline"; // "\ No newline at end of file"
  if (line.startsWith("+")) return "addition";
  if (line.startsWith("-")) return "deletion";
  return "context";
}

function classNameFor(kind: LineKind): string {
  switch (kind) {
    case "fileHeader":
      return "bg-[color:var(--paper-soft)] py-1 text-[color:var(--ink)] font-semibold border-t border-[color:var(--ink-trace)] first:border-t-0";
    case "indexLine":
    case "rangeMarker":
      return "bg-[color:var(--paper-soft)] text-[color:var(--ink-faint)]";
    case "hunkHeader":
      return "bg-[color:var(--paper-soft)] text-[color:var(--accent)]";
    case "addition":
      // Tailwind v4 doesn't ship arbitrary opacity for inherited vars,
      // so colourise the cell background with a soft green and keep the
      // body text crisp. The exact hex matches well in both themes.
      return "bg-[#e6f7ea] text-[#0f6c2c] dark:bg-[#16341f] dark:text-[#b6f3c5]";
    case "deletion":
      return "bg-[#fde8e8] text-[#8a1c1c] dark:bg-[#3a1818] dark:text-[#ffb4b4]";
    case "noNewline":
      return "text-[color:var(--ink-faint)] italic";
    case "context":
    default:
      return "text-[color:var(--ink-soft)]";
  }
}
