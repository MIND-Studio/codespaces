"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authedFetch } from "@/lib/auth/csrf-client";

type SignedInProps = {
  webId: string;
  displayName: string;
  ownerSlug: string | null;
  initials: string;
};

type Props = {
  session: SignedInProps | null;
};

/**
 * Header CTA. Signed out → a plain Link to the dedicated /login page;
 * no modal, no portal, no stacking-context fights with theme overlays.
 * Signed in → an initials avatar with a dropdown (Profile / Connected
 * pods / Sign out).
 *
 * The full sign-in / sign-up form lives at `/login`.
 */
export function AuthCta(props: Props) {
  if (props.session) {
    return <UserMenu session={props.session} />;
  }
  return (
    <Link
      href="/login"
      className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded border border-[color:var(--accent)] px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent)] transition-colors hover:bg-[color:var(--accent)] hover:text-[color:var(--paper)] sm:px-3"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      Sign in
    </Link>
  );
}

/* -------------------------------------------------------------------- */
/* Signed-in: initials + dropdown                                       */
/* -------------------------------------------------------------------- */

function UserMenu({ session }: { session: SignedInProps }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Portal target only exists after the browser mounts the tree.
  useEffect(() => setMounted(true), []);

  // The dropdown renders via a portal under <body> so it escapes the
  // header's `backdrop-filter` ancestor — Safari otherwise clips the
  // dropdown's hit area to the header's bounds in the neo theme (clicks
  // on rows that extend below the header fall through). Recompute the
  // pinned position on scroll/resize while the menu is open.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    function compute() {
      const r = buttonRef.current!.getBoundingClientRect();
      setPos({
        top: r.bottom + 8,
        right: Math.max(8, window.innerWidth - r.right),
      });
    }
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("scroll", compute, true);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("scroll", compute, true);
    };
  }, [open]);

  // Close on outside click + Escape. The menu lives in a portal, so the
  // outside-click check has to consider BOTH the trigger and the menu.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    try {
      await authedFetch("/api/auth/logout", { method: "POST" });
    } finally {
      setOpen(false);
      router.refresh();
    }
  }

  const menu =
    open && mounted && pos ? (
      <div
        ref={menuRef}
        role="menu"
        className="w-60 rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper)] py-2 text-sm shadow-md"
        style={{
          position: "fixed",
          top: pos.top,
          right: pos.right,
          zIndex: 60,
        }}
      >
        <div className="px-3 pb-2">
          <p
            className="truncate text-[color:var(--ink)]"
            style={{ fontWeight: 500 }}
          >
            {session.displayName}
          </p>
          <p
            className="mt-0.5 truncate text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
            title={session.webId}
          >
            {session.webId}
          </p>
        </div>
        <hr className="hairline" />
        <Link
          href="/profile"
          onClick={() => setOpen(false)}
          className="block px-3 py-2 text-[color:var(--ink-soft)] hover:bg-[color:var(--paper-soft)] hover:text-[color:var(--accent)]"
        >
          Your profile
        </Link>
        {session.ownerSlug ? (
          <Link
            href={`/people/${session.ownerSlug}`}
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-[color:var(--ink-soft)] hover:bg-[color:var(--paper-soft)] hover:text-[color:var(--accent)]"
          >
            Public profile
          </Link>
        ) : null}
        <Link
          href="/identities"
          onClick={() => setOpen(false)}
          className="block px-3 py-2 text-[color:var(--ink-soft)] hover:bg-[color:var(--paper-soft)] hover:text-[color:var(--accent)]"
        >
          Connected pods
        </Link>
        <hr className="hairline" />
        <button
          type="button"
          role="menuitem"
          onClick={signOut}
          className="block w-full px-3 py-2 text-left text-[color:var(--ink-soft)] hover:bg-[color:var(--paper-soft)] hover:text-[color:var(--accent)]"
        >
          Sign out
        </button>
      </div>
    ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={session.displayName}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[color:var(--ink-trace)] bg-[color:var(--accent-soft)] text-[11px] uppercase tracking-[0.18em] text-[color:var(--accent-deep)] transition-colors hover:border-[color:var(--accent)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {session.initials}
      </button>
      {mounted && menu ? createPortal(menu, document.body) : null}
    </>
  );
}
