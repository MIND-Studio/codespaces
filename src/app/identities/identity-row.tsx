"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@mind-studio/ui";
import type { Identity } from "@/lib/registry/identities";
import { formatAbsoluteIso, formatRelativeTime } from "@/lib/format";
import { authedFetch } from "@/lib/auth/csrf-client";

export type OwnedRepo = {
  id: number;
  owner: string;
  name: string;
  visibility: string;
};

export function IdentityRow({
  identity,
  ownedRepos,
  podRoot,
}: {
  identity: Identity;
  ownedRepos: OwnedRepo[];
  podRoot: string;
}) {
  const [removed, setRemoved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch(
        `/api/identities/${encodeURIComponent(identity.webId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      setRemoved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
      setBusy(false);
      setConfirming(false);
    }
  }

  if (removed) return null;

  const podBase = podRoot.endsWith("/") ? podRoot : `${podRoot}/`;
  const codespacesGlob = `${podBase}codespaces/*`;
  const sitesGlob = `${podBase}public/sites/*`;

  return (
    <li className="card">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <p
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            owner
          </p>
          <a
            href={identity.webId}
            className="link mt-1 block break-all text-[color:var(--ink)]"
            target="_blank"
            rel="noreferrer"
          >
            {identity.webId}
          </a>
          <p
            className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            issuer {identity.oidcIssuer || "—"} · connected{" "}
            <time
              dateTime={new Date(identity.connectedAt).toISOString()}
              title={formatAbsoluteIso(identity.connectedAt)}
            >
              {formatRelativeTime(identity.connectedAt)}
            </time>
          </p>
        </div>
        <DisconnectControl
          confirming={confirming}
          busy={busy}
          onArm={() => setConfirming(true)}
          onCancel={() => setConfirming(false)}
          onConfirm={disconnect}
        />
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <p
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            repos owned · {ownedRepos.length}
          </p>
          {ownedRepos.length === 0 ? (
            <p
              className="mt-2 text-sm text-[color:var(--ink-faint)]"
              style={{ fontStyle: "italic" }}
            >
              none yet — this WebID hasn&apos;t created any repos on the bridge.
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {ownedRepos.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/repos/${r.owner}/${r.name}`}
                    className="inline-flex items-baseline gap-1.5 px-2 py-1 text-[11px] transition-colors"
                    style={{
                      fontFamily: "var(--font-mono-src)",
                      border: "1px solid var(--ink-trace)",
                      color: "var(--ink)",
                      background: "var(--paper-sunk)",
                    }}
                  >
                    <span>
                      {r.owner}
                      <span style={{ color: "var(--ink-faint)" }}>/</span>
                      {r.name}
                    </span>
                    {r.visibility === "private" ? (
                      <span
                        className="text-[9px] uppercase tracking-[0.18em]"
                        style={{ color: "var(--ink-faint)" }}
                      >
                        priv
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            writes scoped to
          </p>
          <ul
            className="mt-2 space-y-1 text-[12px] leading-snug text-[color:var(--ink-soft)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            <li className="break-all">{codespacesGlob}</li>
            <li className="break-all">{sitesGlob}</li>
          </ul>
          <p
            className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            metadata · published sites
          </p>
        </div>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-[color:var(--status-bad)]">{error}</p>
      ) : null}
    </li>
  );
}

function DisconnectControl({
  confirming,
  busy,
  onArm,
  onCancel,
  onConfirm,
}: {
  confirming: boolean;
  busy: boolean;
  onArm: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirming) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onArm}
        disabled={busy}
      >
        Disconnect
      </Button>
    );
  }
  return (
    <div
      className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] uppercase tracking-[0.18em]"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      <span style={{ color: "var(--ink-soft)" }}>are you sure?</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCancel}
        disabled={busy}
        data-testid="confirm-cancel"
      >
        cancel
      </Button>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={onConfirm}
        disabled={busy}
        data-testid="confirm-accept"
      >
        {busy ? "revoking…" : "revoke"}
      </Button>
    </div>
  );
}
