import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/auth/session";
import { listActivityForWebId, type ActivityItem } from "@/lib/registry/activity";
import {
  listConfiguredProviders,
  getUserAiPref,
} from "@/lib/ai-providers/store";
import { getProvider } from "@/lib/ai-providers/providers";
import { RelativeTime } from "@/components/relative-time";
import ProfileView from "../people/profile-view";
import { ProfileSettings } from "./profile-settings";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<ActivityItem["kind"], string> = {
  "repo.created": "repo",
  "issue.opened": "issue",
  "issue.commented": "comment",
  "pull.opened": "pull",
  "pull.merged": "merged",
  "agent.ran": "agent",
};

const KIND_ACCENT: Record<ActivityItem["kind"], string> = {
  "repo.created": "var(--accent)",
  "issue.opened": "var(--accent)",
  "issue.commented": "var(--ink-soft)",
  "pull.opened": "var(--accent)",
  "pull.merged": "var(--status-good, var(--accent))",
  "agent.ran": "var(--ink-soft)",
};

export default async function ProfilePage() {
  const session = await readSession();
  if (!session) {
    redirect("/login?returnTo=/profile");
  }

  const activity = listActivityForWebId(session.webId, 25);
  const configuredProviders = listConfiguredProviders(session.webId);
  const aiPref = getUserAiPref(session.webId);
  const aiPrefProvider = aiPref.provider ? getProvider(aiPref.provider) : null;

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
      <p
        className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        Your profile
      </p>
      <div className="mt-6">
        <ProfileView webId={session.webId} />
      </div>

      <hr className="hairline my-10" />

      <section>
        <h2
          className="display text-2xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Recent activity
        </h2>
        <p className="mt-2 text-sm text-[color:var(--ink-soft)]">
          Issues you&apos;ve filed, pulls you&apos;ve opened, agent runs on
          your repos. Latest first.
        </p>
        <div className="mt-5">
          {activity.length === 0 ? (
            <p
              className="rounded border border-dashed border-[color:var(--ink-trace)] px-4 py-6 text-center text-sm italic text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              No activity yet. File an issue or push a repo to see it land
              here.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {activity.map((a, i) => (
                <li
                  key={`${a.kind}-${a.ts}-${i}`}
                  className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span
                      className="text-[10px] uppercase tracking-[0.18em]"
                      style={{
                        fontFamily: "var(--font-mono-src)",
                        color: KIND_ACCENT[a.kind],
                      }}
                    >
                      {KIND_LABEL[a.kind]}
                    </span>
                    <RelativeTime
                      ts={a.ts}
                      className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
                      style={{ fontFamily: "var(--font-mono-src)" }}
                    />
                  </div>
                  <p className="mt-1 text-sm leading-snug text-[color:var(--ink)]">
                    <Link
                      href={a.href}
                      className="hover:text-[color:var(--accent)]"
                    >
                      {a.title}
                    </Link>
                  </p>
                  {a.detail ? (
                    <p
                      className="mt-1 text-xs text-[color:var(--ink-soft)] break-words"
                      style={{ fontFamily: "var(--font-mono-src)", overflowWrap: "anywhere" }}
                    >
                      {a.detail}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>

      <hr className="hairline my-10" />

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2
            className="display text-2xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            AI providers
          </h2>
          <Link
            href="/profile/ai-providers"
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            manage →
          </Link>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[color:var(--ink-soft)]">
          The coder agent uses these on issues you file or comment on in
          your own repos. Keys are encrypted at rest; only the last 4
          characters are visible after save.
        </p>
        <div className="mt-4">
          {aiPrefProvider && aiPref.model ? (
            <p
              className="text-[12px] uppercase tracking-[0.18em]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              <span className="text-[color:var(--ink-faint)]">default · </span>
              <span className="text-[color:var(--accent)]">
                {aiPrefProvider.label}
              </span>
              <span className="mx-2 text-[color:var(--ink-faint)]">/</span>
              <span>{aiPref.model}</span>
            </p>
          ) : (
            <p
              className="text-[12px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              default · using the bridge-default
            </p>
          )}
          <p
            className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {configuredProviders.length === 0
              ? "no keys configured"
              : `${configuredProviders.length} provider${configuredProviders.length === 1 ? "" : "s"} configured · ${configuredProviders
                  .map((p) => p.provider)
                  .join(", ")}`}
          </p>
        </div>
      </section>

      <hr className="hairline my-10" />

      <section>
        <h2
          className="display text-2xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Settings
        </h2>
        <div className="mt-5">
          <ProfileSettings />
        </div>
      </section>
    </div>
  );
}
