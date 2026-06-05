"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input } from "@mind-studio/ui";
import { authedFetch } from "@/lib/auth/csrf-client";

// -----------------------------------------------------------------------
// General — visibility + default branch
// -----------------------------------------------------------------------

export function GeneralForm({
  owner,
  name,
  visibility: initialVisibility,
  defaultBranch: initialBranch,
  proposalsEnabled: initialProposals,
  collabEnabled: initialCollab,
}: {
  owner: string;
  name: string;
  visibility: "public" | "private";
  defaultBranch: string;
  proposalsEnabled: boolean;
  collabEnabled: boolean;
}) {
  const router = useRouter();
  const [visibility, setVisibility] = useState(initialVisibility);
  const [defaultBranch, setDefaultBranch] = useState(initialBranch);
  const [proposalsEnabled, setProposalsEnabled] = useState(initialProposals);
  const [collabEnabled, setCollabEnabled] = useState(initialCollab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    visibility !== initialVisibility ||
    defaultBranch !== initialBranch ||
    proposalsEnabled !== initialProposals ||
    collabEnabled !== initialCollab;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await authedFetch(`/api/repos/${owner}/${name}`, {
        method: "PATCH",
        body: JSON.stringify({
          visibility,
          defaultBranch,
          proposalsEnabled,
          collabEnabled,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex max-w-2xl flex-col gap-5 text-sm"
    >
      <Field
        label="Visibility"
        hint="Private repos require a token to clone. Public repos still require a token to push."
      >
        <div className="flex gap-2">
          {(["public", "private"] as const).map((v) => (
            <Button
              key={v}
              type="button"
              variant={visibility === v ? "default" : "outline"}
              size="sm"
              onClick={() => setVisibility(v)}
              disabled={busy}
              className="uppercase tracking-[0.18em]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              {v}
            </Button>
          ))}
        </div>
      </Field>

      <Field
        label="Default branch"
        hint="Used by Mind Pages as the source branch when none is specified. Renaming here does not move refs server-side."
      >
        <Input
          type="text"
          value={defaultBranch}
          onChange={(e) => setDefaultBranch(e.target.value)}
          maxLength={64}
          disabled={busy}
          className="w-full max-w-xs"
          style={{ fontFamily: "var(--font-mono-src)" }}
        />
      </Field>

      <Field
        label="Issue proposals"
        hint="When on, anyone (including logged-out visitors) can propose an issue. Proposals land in your pod inbox for review on the Proposals tab — they aren't added to the tracker until you accept them."
      >
        <label className="inline-flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={proposalsEnabled}
            onChange={(e) => setProposalsEnabled(e.target.checked)}
            disabled={busy}
            className="h-4 w-4 accent-[color:var(--accent)]"
          />
          <span
            className="text-[12px] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {proposalsEnabled ? "open" : "closed"}
          </span>
        </label>
      </Field>

      <Field
        label="Live multiplayer"
        hint="When on, an issue/epic draft is co-edited in real time — share the draft link and several people write together with live cursors. When off, drafting still works but stays local to your browser (no relay, no presence)."
      >
        <label className="inline-flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={collabEnabled}
            onChange={(e) => setCollabEnabled(e.target.checked)}
            disabled={busy}
            className="h-4 w-4 accent-[color:var(--accent)]"
          />
          <span
            className="text-[12px] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {collabEnabled ? "live" : "local-only"}
          </span>
        </label>
      </Field>

      <FormFooter
        busy={busy}
        dirty={dirty}
        saved={saved}
        error={error}
        label="Save general"
      />
    </form>
  );
}

// -----------------------------------------------------------------------
// Mind Pages config
// -----------------------------------------------------------------------

export function PagesForm({
  owner,
  name,
  initial,
}: {
  owner: string;
  name: string;
  initial: {
    enabled: boolean;
    sourceBranch: string;
    sourcePath: string;
    targetContainer: string;
  };
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [sourceBranch, setSourceBranch] = useState(initial.sourceBranch);
  const [sourcePath, setSourcePath] = useState(initial.sourcePath);
  const [targetContainer, setTargetContainer] = useState(initial.targetContainer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    enabled !== initial.enabled ||
    sourceBranch !== initial.sourceBranch ||
    sourcePath !== initial.sourcePath ||
    targetContainer !== initial.targetContainer;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await authedFetch(`/api/repos/${owner}/${name}/pages`, {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          sourceBranch,
          sourcePath,
          targetContainer,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-5 text-sm">
      <Field
        label="Publishing"
        hint="When enabled, every push to the source branch publishes the source path into the target container."
      >
        <label className="inline-flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={busy}
            className="h-4 w-4 accent-[color:var(--accent)]"
          />
          <span
            className="text-[12px] uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {enabled ? "live" : "off"}
          </span>
        </label>
      </Field>

      <Field
        label="Source branch"
        hint="Pushes to other branches are stored but not published."
      >
        <Input
          type="text"
          value={sourceBranch}
          onChange={(e) => setSourceBranch(e.target.value)}
          maxLength={64}
          disabled={busy}
          className="w-full max-w-xs"
          style={{ fontFamily: "var(--font-mono-src)" }}
        />
      </Field>

      <Field
        label="Source path"
        hint={"Subdirectory inside the repo to publish. Use '/' for the whole repo."}
      >
        <Input
          type="text"
          value={sourcePath}
          onChange={(e) => setSourcePath(e.target.value)}
          disabled={busy}
          className="w-full max-w-xs"
          style={{ fontFamily: "var(--font-mono-src)" }}
        />
      </Field>

      <Field
        label="Target container"
        hint="Solid container URL on the owner's pod. The publisher creates files inside it; ACLs are managed by the pod."
      >
        <Input
          type="url"
          value={targetContainer}
          onChange={(e) => setTargetContainer(e.target.value)}
          disabled={busy}
          placeholder="https://your-pod.example/public/sites/hello/"
          className="w-full"
          style={{ fontFamily: "var(--font-mono-src)" }}
        />
      </Field>

      <FormFooter
        busy={busy}
        dirty={dirty}
        saved={saved}
        error={error}
        label="Save pages config"
      />
    </form>
  );
}

// -----------------------------------------------------------------------
// Danger zone — delete repo
// -----------------------------------------------------------------------

export function DangerZone({ owner, name }: { owner: string; name: string }) {
  const router = useRouter();
  const expected = `${owner}/${name}`;
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enabled = confirm === expected && !busy;

  async function destroy() {
    if (!enabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/repos/${owner}/${name}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `request failed (${res.status})`);
      }
      router.push("/repos");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
      setBusy(false);
    }
  }

  return (
    <div
      className="rounded border-l-2 p-5"
      style={{
        borderColor: "var(--status-bad)",
        background: "color-mix(in srgb, var(--status-bad) 4%, transparent)",
      }}
    >
      <h3
        className="display text-lg"
        style={{ fontFamily: "var(--font-display)", color: "var(--status-bad)" }}
      >
        Delete this repository
      </h3>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[color:var(--ink-soft)]">
        Drops the registry rows (repo, pages config, tokens, runs, issues,
        pulls, agent runs) and removes the bare git repo from disk. The
        published site already on the pod is <strong>not</strong> deleted —
        you own that container. Cannot be undone.
      </p>
      <p className="mt-4 text-sm text-[color:var(--ink-soft)]">
        Type <code className="kbd">{expected}</code> to confirm:
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Input
          type="text"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={busy}
          placeholder={expected}
          className="min-w-[16rem]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        />
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={destroy}
          disabled={!enabled}
          className="uppercase tracking-[0.18em]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          <span>{busy ? "dropping…" : "Delete repository"}</span>
        </Button>
      </div>
      {error ? (
        <p className="mt-3 text-[color:var(--status-bad)]">{error}</p>
      ) : null}
    </div>
  );
}

// -----------------------------------------------------------------------
// Form primitives
// -----------------------------------------------------------------------

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p
        className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        {label}
      </p>
      {children}
      {hint ? (
        <p className="text-[11px] leading-relaxed text-[color:var(--ink-soft)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function FormFooter({
  busy,
  dirty,
  saved,
  error,
  label,
}: {
  busy: boolean;
  dirty: boolean;
  saved: boolean;
  error: string | null;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 pt-2">
      <Button
        type="submit"
        variant="default"
        size="sm"
        disabled={busy || !dirty}
        className="uppercase tracking-[0.18em]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        <span>{busy ? "saving…" : label}</span>
      </Button>
      {!dirty && !error ? (
        <span
          className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          {saved ? "✓ saved" : "no changes"}
        </span>
      ) : null}
      {error ? (
        <span className="text-[color:var(--status-bad)] text-sm">{error}</span>
      ) : null}
    </div>
  );
}
