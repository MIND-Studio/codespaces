import Link from "next/link";

type Tab = {
  key: string;
  href: string;
  label: string;
  count?: number;
  external?: boolean;
  active?: boolean;
};

export function NavTabs({ tabs }: { tabs: Tab[] }) {
  return (
    <nav
      className="-mx-6 mt-6 flex items-end gap-x-6 gap-y-1 overflow-x-auto border-b border-[color:var(--ink-trace)] px-6 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      {tabs.map((tab) => {
        const className = [
          "group relative -mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-1 pb-2 pt-1 text-[11px] uppercase tracking-[0.18em] transition-colors",
          tab.active
            ? "border-[color:var(--accent)] text-[color:var(--ink)]"
            : "border-transparent text-[color:var(--ink-soft)] hover:border-[color:var(--accent)] hover:text-[color:var(--ink)]",
        ].join(" ");
        const content = (
          <>
            <span>{tab.label}</span>
            {typeof tab.count === "number" ? (
              <span
                className="rounded-sm bg-[color:var(--paper-sunk)] px-1.5 py-0.5 text-[10px] tracking-[0.14em] text-[color:var(--ink-soft)] group-hover:text-[color:var(--ink)]"
              >
                {tab.count}
              </span>
            ) : null}
            {tab.external ? (
              <span aria-hidden="true" className="text-[color:var(--ink-faint)]">
                ↗
              </span>
            ) : null}
          </>
        );
        if (tab.external) {
          return (
            <a
              key={tab.key}
              href={tab.href}
              target="_blank"
              rel="noreferrer"
              className={className}
            >
              {content}
            </a>
          );
        }
        return (
          <Link key={tab.key} href={tab.href} className={className}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
