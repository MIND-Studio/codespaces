import { Button } from "@mind-studio/ui";
import Link from "next/link";

/**
 * Polite "you need to sign in to do this" card. Used in two places:
 *
 *   1. Server-side, in lieu of a form/action component, when the
 *      session is missing on the rendering request — so the user
 *      never sees a working-looking form that returns 401 on submit.
 *
 *   2. Client-side, by forms that have detected a 401 mid-flight
 *      (e.g., session expired in another tab) so the user gets the
 *      same friendly recovery affordance instead of a red text dump.
 *
 * The `next` query string round-trips the user back to wherever they
 * were after they finish signing in.
 */
export function SignInWall({
  action,
  next,
  compact,
}: {
  /** Human-readable verb phrase for what's gated, e.g. "leave a comment". */
  action: string;
  /** URL to return to after auth. Pass the current pathname (+ optional hash). */
  next?: string;
  /** Tighter padding for use under existing buttons. */
  compact?: boolean;
}) {
  // /login takes `?returnTo=<local path>` (validated server-side; cross-origin
  // values are dropped). Pass the same value to /signup and /connect — they
  // currently ignore it, but the param is harmless and we can wire it up later.
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const qs = safe ? `?returnTo=${encodeURIComponent(safe)}` : "";
  const loginHref = `/login${qs}`;
  const signupHref = `/signup${qs}`;
  const connectHref = `/connect${qs}`;

  return (
    <aside
      role="status"
      aria-live="polite"
      className={`overflow-hidden rounded-lg border border-primary/40 bg-primary/8`}
    >
      <div
        className={`flex items-center justify-between gap-3 border-b border-primary/25 bg-primary/10 px-4 ${compact ? "py-1.5" : "py-2"} font-mono text-[10px] uppercase tracking-[0.22em] text-primary`}
      >
        <span>// sign in required</span>
      </div>
      <div className={compact ? "px-4 py-3" : "px-4 py-4 sm:px-5 sm:py-5"}>
        <p className={`${compact ? "text-sm" : "text-base"} text-foreground`}>
          You need a session to <strong>{action}</strong>.
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          The bridge never sees your pod password — sign-in happens against your own pod, and the
          bridge only stores the resulting refresh token (encrypted at rest).
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href={loginHref}>Sign in</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={signupHref}>Create account</Link>
          </Button>
          <Link
            href={connectHref}
            className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-primary"
          >
            or connect an external pod →
          </Link>
        </div>
      </div>
    </aside>
  );
}
