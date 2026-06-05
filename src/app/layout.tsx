import type { Metadata } from "next";
import Link from "next/link";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ThemeShell } from "@/components/theme-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { PageTransition } from "@/components/page-transition";
import { AuthCtaServer } from "@/components/auth-cta-server";
import { MainNav } from "@/components/main-nav";
import { readSession } from "@/lib/auth/session";
import { MindAppLauncher } from "@mind-studio/core/launcher";
import { DEFAULT_APPS } from "@mind-studio/core/apps";

/**
 * Mirror both theme axes onto <html> BEFORE first paint to dodge the
 * flash-of-wrong-theme:
 *   • brand  → data-mind-theme   (localStorage `mc:brand`, default "mind")
 *   • mode   → .dark / .light    (next-themes key `mc:mode`, default dark)
 * <ThemeShell>/next-themes reconcile these on mount.
 */
const THEME_INIT = `(function(){try{var b=localStorage.getItem("mc:brand");if(b!=="neo"&&b!=="mind")b="mind";document.documentElement.setAttribute("data-mind-theme",b);var m=localStorage.getItem("mc:mode");var dark=m?m==="dark":true;document.documentElement.classList.toggle("dark",dark);document.documentElement.classList.toggle("light",!dark);}catch(e){document.documentElement.setAttribute("data-mind-theme","mind");document.documentElement.classList.add("dark");}})();`;

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
    <html lang="en" className={fontMono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-screen flex flex-col overflow-x-hidden bg-background text-foreground">
        <ThemeShell>
          <Masthead />
          <main className="flex flex-1 flex-col min-w-0">
            <PageTransition>{children}</PageTransition>
          </main>
          <Colophon />
        </ThemeShell>
      </body>
    </html>
  );
}

async function Masthead() {
  const session = await readSession();
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-3 py-3 sm:gap-8 sm:px-10 sm:py-5">
        <Link href="/" className="flex shrink-0 items-baseline gap-3">
          <span className="display whitespace-nowrap text-lg tracking-tight sm:text-2xl">
            Mind <em>Codespaces</em>
          </span>
          <span className="hidden whitespace-nowrap text-[10px] uppercase tracking-[0.22em] text-muted-foreground lg:inline">
            <span className="text-primary">●</span> solid git bridge
          </span>
        </Link>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <MainNav signedIn={!!session} />
          <span
            aria-hidden
            className="hidden h-5 w-px bg-border sm:inline-block"
          />
          {session ? (
            <MindAppLauncher
              apps={DEFAULT_APPS}
              triggerClassName="grid size-8 place-items-center rounded-md text-muted-foreground outline-none transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : null}
          <ThemeToggle />
          <AuthCtaServer />
        </div>
      </div>
    </header>
  );
}

function Colophon() {
  return (
    <footer className="mt-16 border-t border-border bg-card">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8 sm:flex-row sm:items-start sm:justify-between sm:px-10 sm:py-10">
        <div className="max-w-md">
          <p className="display text-2xl">
            Mind <em>Codespaces</em>
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            A prototype bridge between Git and Solid Pods. Git stays Git; the pod
            owns identity, metadata, and the published site.
          </p>
        </div>
        <nav
          aria-label="Footer"
          className="flex flex-col gap-1 font-mono text-[11px] uppercase tracking-[0.18em]"
        >
          <span className="text-[10px] tracking-[0.22em] text-muted-foreground">
            // learn
          </span>
          <Link
            href="/how-it-works"
            className="text-muted-foreground hover:text-primary"
          >
            How it works
          </Link>
          <Link
            href="/#start-here"
            className="text-muted-foreground hover:text-primary"
          >
            Quickstart
          </Link>
          <Link
            href="/api/health"
            className="text-muted-foreground hover:text-primary"
          >
            Health
          </Link>
        </nav>
      </div>
      <div className="mx-auto max-w-5xl px-4 pb-8 sm:px-10 sm:pb-10">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Sibling of <span className="italic">Mind Market</span> · No third-party
          analytics · No cookies set beyond strictly necessary
        </p>
      </div>
    </footer>
  );
}
