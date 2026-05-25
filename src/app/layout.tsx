import type { Metadata } from "next";
import Link from "next/link";
import { DM_Sans, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeToggle } from "@/components/theme-toggle";
import { PageTransition } from "@/components/page-transition";
import { AuthCtaServer } from "@/components/auth-cta-server";

/**
 * Sets data-theme="dark" on <html> BEFORE first paint by reading the
 * user's stored preference (mc:theme) or the OS preference. Inlined
 * to dodge the flash-of-wrong-theme problem.
 */
const THEME_INIT = `(function(){try{var s=localStorage.getItem("mc:theme");var p=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches;var t=s||(p?"dark":"light");if(t==="dark"||t==="neo")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

const fontDisplay = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["SOFT", "WONK", "opsz"],
  style: ["normal", "italic"],
});

const fontBody = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const fontMono = JetBrains_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Mind Codespaces — Solid Git Bridge",
  description:
    "A tiny bridge that lets you git push to your own Solid Pod. Identity through WebID, version control via Git, sites published to user-owned containers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fontBody.variable} ${fontDisplay.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen flex flex-col">
        <Masthead />
        <main className="flex flex-1 flex-col">
          <PageTransition>{children}</PageTransition>
        </main>
        <Colophon />
      </body>
    </html>
  );
}

async function Masthead() {
  return (
    <header className="border-b border-[color:var(--ink-trace)] bg-[color:var(--paper)]">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:gap-8 sm:px-10 sm:py-5">
        <Link href="/" className="flex items-baseline gap-3">
          <span
            className="display text-xl tracking-tight sm:text-2xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Mind <em>Codespaces</em>
          </span>
          <span className="hidden text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)] sm:inline">
            <span className="text-[color:var(--accent)]">●</span> solid git bridge
          </span>
        </Link>
        <nav
          className="-mx-4 flex w-full items-center gap-1 overflow-x-auto px-4 text-[11px] uppercase tracking-[0.18em] sm:mx-0 sm:w-auto sm:flex-wrap sm:gap-2 sm:overflow-visible sm:px-0"
          aria-label="Main"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <Link
            href="/repos"
            className="whitespace-nowrap px-2 py-1 text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
          >
            Repos
          </Link>
          <Link
            href="/how-it-works"
            className="whitespace-nowrap px-2 py-1 text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
          >
            How it works
          </Link>
          <Link
            href="/people"
            className="whitespace-nowrap px-2 py-1 text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
          >
            People
          </Link>
          <ThemeToggle />
          <AuthCtaServer />
        </nav>
      </div>
    </header>
  );
}

function Colophon() {
  return (
    <footer className="mt-16 border-t border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)]">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-10 sm:py-10">
        <p
          className="display text-2xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Mind <em>Codespaces</em>
        </p>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-[color:var(--ink-soft)]">
          A prototype bridge between Git and Solid Pods. Git stays Git; the pod
          owns identity, metadata, and the published site.
        </p>
        <p
          className="mt-6 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Sibling of <span className="italic" style={{ fontFamily: "var(--font-display)" }}>Mind Market</span> · No third-party analytics · No cookies set beyond strictly necessary ·{" "}
          <Link
            href="/api/health"
            className="text-[color:var(--ink-faint)] underline decoration-[color:var(--ink-trace)] underline-offset-2 hover:text-[color:var(--accent)] hover:decoration-[color:var(--accent)]"
          >
            health
          </Link>
        </p>
      </div>
    </footer>
  );
}
