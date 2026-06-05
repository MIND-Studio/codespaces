"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
  buttonVariants,
} from "@mind-studio/ui";
import { authedFetch } from "@/lib/auth/csrf-client";
import type {
  ProviderSpec,
  ProviderName,
} from "@/lib/ai-providers/providers";

type Configured = {
  provider: ProviderName;
  hint: string;
  createdAt: number;
  updatedAt: number;
};

type Pref = {
  provider: ProviderName | null;
  model: string | null;
  updatedAt: number | null;
};

export function AiProvidersManager({
  providers,
  configured,
  pref,
}: {
  providers: ProviderSpec[];
  configured: Configured[];
  pref: Pref;
}) {
  return (
    <div className="space-y-12">
      <DefaultSelector providers={providers} configured={configured} pref={pref} />
      <section>
        <h2
          className="display text-2xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Keys
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[color:var(--ink-soft)]">
          One key per provider. Adding a key replaces any existing key for
          that provider; only the last 4 characters are shown after save.
        </p>
        <div className="mt-6 space-y-4">
          {providers.map((p) => (
            <ProviderCard
              key={p.name}
              spec={p}
              configured={configured.find((c) => c.provider === p.name) ?? null}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

// -----------------------------------------------------------------------
// Default provider + model selector
// -----------------------------------------------------------------------

function DefaultSelector({
  providers,
  configured,
  pref,
}: {
  providers: ProviderSpec[];
  configured: Configured[];
  pref: Pref;
}) {
  const router = useRouter();
  const [provider, setProvider] = useState<ProviderName | "">(
    pref.provider ?? "",
  );
  const [model, setModel] = useState(pref.model ?? "");
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const selectedSpec = useMemo(
    () => providers.find((p) => p.name === provider) ?? null,
    [providers, provider],
  );
  const hasKey = configured.some((c) => c.provider === provider);
  const dirty = provider !== (pref.provider ?? "") || model !== (pref.model ?? "");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body =
        provider === ""
          ? { provider: null, model: null }
          : { provider, model: model.trim() };
      const res = await authedFetch("/api/profile/ai/pref", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `request failed (${res.status})`);
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
    <section>
      <h2
        className="display text-2xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Default model
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[color:var(--ink-soft)]">
        Applies to every repo you own. The coder uses this provider + model
        for every issue it picks up. Leave blank to fall back to the
        bridge-default <code className="kbd">MIND_AGENT_MODEL</code>.
      </p>

      <form onSubmit={submit} className="mt-5 flex max-w-2xl flex-col gap-5 text-sm">
        <Field label="Provider">
          <Select
            // Radix Select can't use "" as an item value, so map the
            // "bridge default" sentinel to "__none__" at the boundary.
            value={provider === "" ? "__none__" : provider}
            onValueChange={(raw) => {
              const next = (raw === "__none__" ? "" : raw) as ProviderName | "";
              setProvider(next);
              const spec = providers.find((p) => p.name === next);
              // Pre-fill model with the first curated option for that
              // provider, but keep the value if the user already typed
              // something custom.
              if (spec && !custom) {
                setModel(spec.models[0]?.id ?? "");
              } else if (!next) {
                setModel("");
              }
            }}
            disabled={busy}
          >
            <SelectTrigger
              className="w-full max-w-xs"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— bridge default —</SelectItem>
              {providers.map((p) => {
                const has = configured.some((c) => c.provider === p.name);
                return (
                  <SelectItem key={p.name} value={p.name} disabled={!has}>
                    {p.label}
                    {has ? "" : " (no key configured)"}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </Field>

        {selectedSpec ? (
          <>
            <Field label="Model" hint={`opencode will be invoked with: -m ${selectedSpec.opencodeModelPrefix}/${model || "<model>"}`}>
              <div className="flex flex-col gap-2">
                {!custom ? (
                  <Select
                    value={model}
                    onValueChange={(v) => setModel(v)}
                    disabled={busy}
                  >
                    <SelectTrigger
                      className="w-full"
                      style={{ fontFamily: "var(--font-mono-src)" }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedSpec.models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label} {m.note ? `· ${m.note}` : ""} ({m.id})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={selectedSpec.models[0]?.id ?? "model-id"}
                    disabled={busy}
                    className="w-full"
                    style={{ fontFamily: "var(--font-mono-src)" }}
                  />
                )}
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setCustom((c) => !c);
                    if (custom) setModel(selectedSpec.models[0]?.id ?? "");
                  }}
                  className="self-start px-2 -mx-2 text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
                  style={{ fontFamily: "var(--font-mono-src)" }}
                >
                  {custom ? "← pick from list" : "use custom model id →"}
                </Button>
              </div>
            </Field>
            {!hasKey ? (
              <p className="text-[11px] text-[color:var(--status-bad)]">
                No key configured for {selectedSpec.label}. Add one below
                before saving — saving will be rejected otherwise.
              </p>
            ) : null}
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-4 pt-2">
          <Button
            type="submit"
            variant="default"
            size="sm"
            disabled={busy || !dirty}
            className="uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            <span>{busy ? "saving…" : "Save default"}</span>
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
            <span className="text-sm text-[color:var(--status-bad)]">{error}</span>
          ) : null}
        </div>
      </form>
    </section>
  );
}

// -----------------------------------------------------------------------
// Per-provider key card
// -----------------------------------------------------------------------

function ProviderCard({
  spec,
  configured,
}: {
  spec: ProviderSpec;
  configured: Configured | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (apiKey.trim().length < 8) {
      setError("key looks too short");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/profile/ai/keys/${spec.name}`, {
        method: "POST",
        body: JSON.stringify({ apiKey }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `request failed (${res.status})`);
      }
      setApiKey("");
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await authedFetch(`/api/profile/ai/keys/${spec.name}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `request failed (${res.status})`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper-soft)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <p
            className="text-[12px] uppercase tracking-[0.18em] text-[color:var(--ink)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {spec.label}
          </p>
          <p className="mt-1 max-w-md text-sm leading-relaxed text-[color:var(--ink-soft)]">
            {spec.blurb}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {configured ? (
            <span
              className="stamp"
              data-tone="ok"
              style={{ padding: "0.18rem 0.5rem 0.14rem" }}
            >
              configured · {configured.hint}
            </span>
          ) : (
            <span
              className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              not configured
            </span>
          )}
          <a
            href={spec.keysUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            get a key ↗
          </a>
        </div>
      </div>

      {open ? (
        <form onSubmit={save} className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex w-full flex-1 flex-col gap-1 sm:min-w-[18rem]">
            <span
              className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              API key
              {spec.keyShapeHint ? (
                <span className="ml-2 normal-case tracking-normal">
                  (looks like {spec.keyShapeHint})
                </span>
              ) : null}
            </span>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={busy}
              className="w-full"
              style={{ fontFamily: "var(--font-mono-src)" }}
            />
          </label>
          <Button
            type="submit"
            variant="default"
            size="sm"
            disabled={busy || apiKey.trim().length < 8}
            className="uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            <span>{busy ? "saving…" : "Save key"}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setOpen(false);
              setApiKey("");
              setError(null);
            }}
            className="uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="mt-3 flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            className="uppercase tracking-[0.18em]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            {configured ? "Replace key" : "Add key"}
          </Button>
          {configured ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  className="uppercase tracking-[0.18em]"
                  style={{ fontFamily: "var(--font-mono-src)" }}
                >
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove your {spec.label} key?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Remove your {spec.label} key? The coder will fall back to the
                    bridge default until you add a new one.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel data-testid="confirm-cancel">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    data-testid="confirm-accept"
                    className={buttonVariants({ variant: "destructive" })}
                    onClick={remove}
                  >
                    Confirm
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      )}
      {error ? (
        <p className="mt-3 text-sm text-[color:var(--status-bad)]">{error}</p>
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
        <p
          className="text-[11px] leading-relaxed text-[color:var(--ink-soft)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
