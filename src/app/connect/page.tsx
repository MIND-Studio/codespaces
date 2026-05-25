import { ConnectForm } from "./connect-form";

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

export default function ConnectPage() {
  const defaultIssuer = process.env.POD_BASE_URL ?? DEFAULT_ISSUER;
  const ISSUER_PRESETS = buildIssuerPresets(defaultIssuer);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-10 sm:py-16">
      <p className="section-mark">
        Identity <span style={{ color: "var(--accent)" }}>/ delegation</span>
      </p>
      <h1
        className="display mt-3 text-3xl sm:text-4xl md:text-5xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Connect a <em>pod</em>.
      </h1>
      <p className="mt-4 max-w-2xl text-[color:var(--ink-soft)]">
        Mind Codespaces needs permission to write into your pod (your published
        site, and a Turtle description of each repo). You authorize that here
        via your pod&apos;s own OIDC issuer — the bridge never sees your
        password, only a token your pod issues to it.
      </p>

      <hr className="hairline my-10" />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-14">
        <section>
          <p
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            01 — authorize
          </p>
          <h2
            className="display mt-2 text-2xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Point us at your issuer.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-[color:var(--ink-soft)]">
            Most pods publish their OIDC issuer at the pod&apos;s root URL.
            Pick a preset or paste your own.
          </p>

          <div className="mt-6">
            <ConnectForm defaultIssuer={defaultIssuer} presets={ISSUER_PRESETS} />
          </div>
        </section>

        <aside>
          <p
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            What this means
          </p>
          <h2
            className="display mt-2 text-2xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            A token, not a key.
          </h2>

          <ul className="mt-6 space-y-4">
            <TrustItem
              kicker="Login"
              title="The bridge never sees your password."
              body="Your pod runs the login UI. We only receive the token it issues back to us."
            />
            <TrustItem
              kicker="Revocable"
              title="You can revoke at any time."
              body={
                <>
                  Disconnect from the{" "}
                  <a href="/identities" className="link">
                    identities page
                  </a>{" "}
                  and the bridge loses access immediately.
                </>
              }
            />
            <TrustItem
              kicker="No setup"
              title="We register dynamically."
              body="No pre-shared API key, no admin console. The bridge introduces itself to your pod via OIDC dynamic client registration."
            />
            <TrustItem
              kicker="Scope"
              title="What we write into your pod."
              body={
                <ul
                  className="mt-2 space-y-1.5 text-xs"
                  style={{ fontFamily: "var(--font-mono-src)" }}
                >
                  <li className="flex items-baseline gap-2">
                    <span style={{ color: "var(--accent)" }}>·</span>
                    <span>
                      <span style={{ color: "var(--ink)" }}>
                        your-pod/codespaces/*
                      </span>{" "}
                      <span style={{ color: "var(--ink-faint)" }}>
                        — repo metadata
                      </span>
                    </span>
                  </li>
                  <li className="flex items-baseline gap-2">
                    <span style={{ color: "var(--accent)" }}>·</span>
                    <span>
                      <span style={{ color: "var(--ink)" }}>
                        your-pod/public/sites/*
                      </span>{" "}
                      <span style={{ color: "var(--ink-faint)" }}>
                        — when Mind Pages is enabled
                      </span>
                    </span>
                  </li>
                </ul>
              }
            />
            <TrustItem
              kicker="Local state"
              title="A refresh token lives on disk."
              body={
                <>
                  We persist it in{" "}
                  <code className="kbd">.registry-data/</code> so a restart
                  doesn&apos;t bounce you out. It never leaves this machine.
                </>
              }
            />
          </ul>
        </aside>
      </div>
    </div>
  );
}

function TrustItem({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <li className="flex items-baseline gap-3 sm:gap-4">
      <span
        className="w-14 shrink-0 text-[9px] uppercase tracking-[0.22em] sm:w-16"
        style={{
          fontFamily: "var(--font-mono-src)",
          color: "var(--accent)",
        }}
      >
        {kicker}
      </span>
      <div className="min-w-0">
        <p
          className="text-sm"
          style={{ color: "var(--ink)", fontWeight: 500 }}
        >
          {title}
        </p>
        <div className="mt-1 text-sm leading-relaxed text-[color:var(--ink-soft)]">
          {body}
        </div>
      </div>
    </li>
  );
}
