import { formatAbsoluteIso, formatRelativeTime } from "@/lib/format";

/**
 * A `<time>` element that renders "5m ago" form with the precise ISO
 * timestamp in its `title` attribute. Server component — computed at
 * render time, so a page with `dynamic = "force-dynamic"` will always
 * show a fresh relative form. (Pages cached longer than a few seconds
 * may go slightly stale; that's an acceptable trade for not shipping a
 * client-side ticking timer.)
 */
export function RelativeTime({
  ts,
  className,
  style,
}: {
  ts: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const iso = new Date(ts).toISOString();
  return (
    <time dateTime={iso} title={formatAbsoluteIso(ts)} className={className} style={style}>
      {formatRelativeTime(ts)}
    </time>
  );
}
