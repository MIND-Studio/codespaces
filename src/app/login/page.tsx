import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { LoginPage } from "./login-page";

export const dynamic = "force-dynamic";

const DEFAULT_ISSUER = "http://localhost:3011/";

function isLoopback(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])(:|\/|$)/.test(url);
}

function buildIssuerPresets(base: string) {
  const ownLabel = isLoopback(base) ? "Local demo" : "This bridge's pod";
  return [
    { url: base, label: ownLabel },
    { url: "https://solidcommunity.net/", label: "solidcommunity.net" },
    { url: "https://login.inrupt.com/", label: "Inrupt" },
  ];
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; returnTo?: string }>;
}) {
  const session = await readSession();
  if (session) {
    // Already signed in — bounce home so /login isn't a useless screen.
    redirect("/");
  }

  const { tab, returnTo } = await searchParams;
  const initialTab = tab === "register" ? "register" : "login";
  const safeReturnTo = sanitizeReturnTo(returnTo);
  const signupEnabled = process.env.BRIDGE_ENABLE_SIGNUP === "1";
  const defaultIssuer = process.env.POD_BASE_URL ?? DEFAULT_ISSUER;
  const ISSUER_PRESETS = buildIssuerPresets(defaultIssuer);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-8 px-4 py-12 sm:px-6 sm:py-20">
      <p className="section-mark">
        Identity <span style={{ color: "var(--accent)" }}>/ via your pod</span>
      </p>

      <LoginPage
        initialTab={initialTab}
        returnTo={safeReturnTo}
        signupEnabled={signupEnabled}
        defaultIssuer={defaultIssuer}
        issuerPresets={ISSUER_PRESETS}
      />

      <p
        className="mt-2 text-center text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        <Link href="/" className="hover:text-[color:var(--accent)]">
          ← back home
        </Link>
      </p>
    </div>
  );
}

/**
 * `returnTo` is an open-redirect hazard if we accept it raw — an attacker
 * can craft `/login?returnTo=https://evil.example/phish` and trick a
 * signed-in user into landing somewhere off-site. Only accept site-local
 * paths beginning with a single `/` and not `//` (which would be a
 * protocol-relative URL).
 */
function sanitizeReturnTo(input: string | undefined): string {
  if (!input || typeof input !== "string") return "/";
  if (!input.startsWith("/")) return "/";
  if (input.startsWith("//")) return "/";
  return input;
}
