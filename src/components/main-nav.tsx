"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@mind-studio/ui";

type Item = {
  href: string;
  label: string;
  /** Match the pathname literally, or any descendant under it. */
  match: "exact" | "prefix";
};

const ITEMS: Item[] = [
  { href: "/repos", label: "Repos", match: "prefix" },
  { href: "/people", label: "People", match: "prefix" },
];

function isActive(pathname: string, item: Item): boolean {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

/**
 * Masthead's link cluster. Client component only because the active-route
 * highlight comes from `usePathname`. Inline at every width — we have few
 * enough items that a hamburger would be more friction than help; the
 * brand subtitle hides on narrow screens to make room.
 */
export function MainNav({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname() ?? "/";
  return (
    <nav
      className="flex items-center gap-1"
      aria-label="Main"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      {ITEMS.map((item) => (
        <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
      ))}
      {signedIn ? (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="ml-1 whitespace-nowrap text-[11px] uppercase tracking-[0.18em] sm:ml-2"
        >
          <Link href="/repos/new" aria-label="New repo">
            <span aria-hidden>+</span>
            <span className="ml-1 hidden sm:inline">New</span>
          </Link>
        </Button>
      ) : null}
    </nav>
  );
}

function NavLink({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className="relative whitespace-nowrap px-1.5 py-1 text-[11px] uppercase tracking-[0.18em] transition-colors sm:px-2"
      style={{
        color: active ? "var(--accent-deep)" : "var(--ink-soft)",
      }}
    >
      <span className="hover:text-[color:var(--accent)]">{item.label}</span>
      <span
        aria-hidden
        className="absolute inset-x-1.5 -bottom-0.5 h-px transition-opacity"
        style={{
          background: "var(--accent)",
          opacity: active ? 1 : 0,
        }}
      />
    </Link>
  );
}
