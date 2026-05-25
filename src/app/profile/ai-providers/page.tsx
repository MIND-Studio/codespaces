import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import {
  listConfiguredProviders,
  getUserAiPref,
} from "@/lib/ai-providers/store";
import { PROVIDERS } from "@/lib/ai-providers/providers";
import { AiProvidersManager } from "./manage";

export const dynamic = "force-dynamic";

export default async function AiProvidersPage() {
  const session = await readSession();
  if (!session) redirect("/connect");

  const configured = listConfiguredProviders(session.webId);
  const pref = getUserAiPref(session.webId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-10">
      <p className="section-mark">
        <Link href="/profile" className="link">
          ← your profile
        </Link>
      </p>
      <h1
        className="display mt-3 text-3xl sm:text-4xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        AI <em>providers</em>
      </h1>
      <p className="mt-3 max-w-2xl leading-relaxed text-[color:var(--ink-soft)]">
        Bring your own keys. The coder agent uses your selected provider
        and model whenever it runs on a repo you own. Keys are encrypted
        at rest with the same AES-256-GCM key that protects your Solid
        refresh tokens, and they never leave this bridge.
      </p>

      <hr className="hairline my-10" />

      <AiProvidersManager
        providers={PROVIDERS}
        configured={configured}
        pref={pref}
      />
    </div>
  );
}
