import type { Metadata } from "next";
import Link from "next/link";
import { DM_Sans, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { PageTransition } from "@/components/page-transition";
import { AuthCtaServer } from "@/components/auth-cta-server";
import { MainNav } from "@/components/main-nav";
import { readSession } from "@/lib/auth/session";

/**
 * Sets data-theme on <html> BEFORE first paint. Default is "dark"; the
 * user can change it from /profile (persisted to localStorage as
 * `mc:theme`). Inlined to dodge the flash-of-wrong-theme problem.
 */
const THEME_INIT = `(function(){try{var s=localStorage.getItem("mc:theme");var t=s||"dark";if(t==="dark"||t==="neo")document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();`;

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
      <body className="min-h-screen flex flex-col overflow-x-hidden">
        <Masthead />
        <main className="flex flex-1 flex-col min-w-0">
          <PageTransition>{children}</PageTransition>
        </main>
        <Colophon />
      </body>
    </html>
  );
}

async function Masthead() {
  const session = await readSession();
  return (
    <header className="border-b border-[color:var(--ink-trace)] bg-[color:var(--paper)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:gap-8 sm:px-10 sm:py-5">
        <Link href="/" className="flex shrink-0 items-baseline gap-3">
          <span
            className="display whitespace-nowrap text-lg tracking-tight sm:text-2xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Mind <em>Codespaces</em>
          </span>
          <span className="hidden whitespace-nowrap text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)] lg:inline">
            <span className="text-[color:var(--accent)]">●</span> solid git bridge
          </span>
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-4">
          <MainNav signedIn={!!session} />
          <span
            aria-hidden
            className="hidden h-5 w-px bg-[color:var(--ink-trace)] sm:inline-block"
          />
          <AuthCtaServer />
        </div>
      </div>
    </header>
  );
}

function Colophon() {
  return (
    <footer className="mt-16 border-t border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-start sm:justify-between sm:px-10 sm:py-10">
        <div className="max-w-md">
          <p
            className="display text-2xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Mind <em>Codespaces</em>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[color:var(--ink-soft)]">
            A prototype bridge between Git and Solid Pods. Git stays Git; the pod
            owns identity, metadata, and the published site.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.18em]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <span className="text-[10px] tracking-[0.22em] text-[color:var(--ink-faint)]">
            // learn
          </span>
          <Link
            href="/how-it-works"
            className="text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
          >
            How it works
          </Link>
          <Link
            href="/"
            className="text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
          >
            Quickstart
          </Link>
          <Link
            href="/api/health"
            className="text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
          >
            Health
          </Link>
        </nav>
      </div>
      <div className="mx-auto max-w-5xl px-4 pb-8 sm:px-10 sm:pb-10">
        <p
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          Sibling of{" "}
          <span
            className="italic"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Mind Market
          </span>{" "}
          · No third-party analytics · No cookies set beyond strictly necessary
        </p>
      </div>
    </footer>
  );
}
