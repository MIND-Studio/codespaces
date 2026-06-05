"use client";

import Link from "next/link";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { Button, Input } from "@mind-studio/ui";
import {
  formatAbsoluteIso,
  formatDuration,
  formatRelativeTime,
} from "@/lib/format";

export type RepoRowData = {
  id: number;
  owner: string;
  ownerIsOrg: boolean;
  name: string;
  visibility: string;
  defaultBranch: string;
  createdAt: number;
  pagesLive: boolean;
  liveUrl: string | null;
  livePath: string | null;
  lastPublishedAt: number | null;
  latestRun: {
    status: string;
    startedAt: number;
    finishedAt: number | null;
    exitCode: number | null;
  } | null;
  activityAt: number;
};

type SortMode = "recent" | "alpha";

export function RepoList({
  rows,
  signedIn,
}: {
  rows: RepoRowData[];
  signedIn: boolean;
}) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const deferredFilter = useDeferredValue(filter);
  const filterId = useId();

  const normalized = deferredFilter.trim().toLowerCase();

  const matched = useMemo(() => {
    if (!normalized) return rows;
    return rows.filter((r) =>
      `${r.owner}/${r.name}`.toLowerCase().includes(normalized),
    );
  }, [rows, normalized]);

  const sorted = useMemo(() => {
    const copy = [...matched];
    if (sort === "alpha") {
      copy.sort((a, b) =>
        `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`),
      );
    } else {
      copy.sort((a, b) => b.activityAt - a.activityAt);
    }
    return copy;
  }, [matched, sort]);

  const totalLive = rows.filter((r) => r.pagesLive).length;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="w-full flex-1 sm:min-w-[14rem] sm:w-auto">
          <label
            htmlFor={filterId}
            className="block text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            // filter
          </label>
          <div className="mt-1.5 flex items-baseline gap-2 border-b border-[color:var(--ink-trace)] pb-1 focus-within:border-[color:var(--accent)]">
            <span
              className="text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
              aria-hidden
            >
              ›
            </span>
            <Input
              id={filterId}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="owner/name"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              className="w-full border-0 bg-transparent p-0 h-auto text-sm text-[color:var(--ink)] placeholder:text-[color:var(--ink-faint)] shadow-none outline-none focus-visible:ring-0"
              style={{ fontFamily: "var(--font-mono-src)" }}
            />
            {filter ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setFilter("")}
                className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)] hover:text-[color:var(--accent)]"
                style={{ fontFamily: "var(--font-mono-src)" }}
                aria-label="Clear filter"
              >
                clear
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className="text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            sort
          </span>
          <div className="flex items-center gap-1.5">
            <SortChip
              active={sort === "recent"}
              onClick={() => setSort("recent")}
              label="recent activity"
            />
            <SortChip
              active={sort === "alpha"}
              onClick={() => setSort("alpha")}
              label="alphabetical"
            />
          </div>
        </div>
      </div>

      <div
        className="mb-4 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
        style={{ fontFamily: "var(--font-mono-src)" }}
      >
        <span>
          {sorted.length} of {rows.length}{" "}
          {rows.length === 1 ? "repo" : "repos"}
        </span>
        <span aria-hidden>·</span>
        <span style={{ color: "var(--accent-deep)" }}>
          {totalLive} live on pages
        </span>
        {normalized ? (
          <>
            <span aria-hidden>·</span>
            <span>filter “{deferredFilter}”</span>
          </>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        normalized ? (
          <FilterEmptyState
            filter={deferredFilter}
            onClear={() => setFilter("")}
            signedIn={signedIn}
          />
        ) : (
          <InitialEmptyState signedIn={signedIn} />
        )
      ) : normalized ? (
        <ul className="flex flex-col gap-2.5">
          {sorted.map((row) => (
            <li key={row.id}>
              <RepoCard row={row} highlight={normalized} />
            </li>
          ))}
        </ul>
      ) : (
        <GroupedList rows={sorted} sort={sort} />
      )}
    </div>
  );
}

function GroupedList({ rows, sort }: { rows: RepoRowData[]; sort: SortMode }) {
  const grouped = useMemo(() => groupByOwner(rows, sort), [rows, sort]);
  return (
    <div className="space-y-10">
      {grouped.map(({ owner, ownerIsOrg, rows: ownerRows, liveCount }) => (
        <section key={owner}>
          <div className="mb-3 flex items-baseline justify-between border-b border-[color:var(--ink-trace)] pb-2">
            <h2
              className="text-[11px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              {ownerIsOrg ? `${owner} · org` : owner}
            </h2>
            <span
              className="text-[10px] uppercase tracking-[0.18em] text-[color:var(--ink-faint)]"
              style={{ fontFamily: "var(--font-mono-src)" }}
            >
              {ownerRows.length} {ownerRows.length === 1 ? "repo" : "repos"}
              {liveCount > 0 ? (
                <>
                  {" "}
                  ·{" "}
                  <span style={{ color: "var(--accent-deep)" }}>
                    {liveCount} live
                  </span>
                </>
              ) : null}
            </span>
          </div>
          <ul className="flex flex-col gap-2.5">
            {ownerRows.map((row) => (
              <li key={row.id}>
                <RepoCard row={row} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function RepoCard({
  row,
  highlight,
}: {
  row: RepoRowData;
  highlight?: string;
}) {
  const cardStyle = row.pagesLive
    ? { borderLeft: "1px solid var(--accent)" }
    : undefined;
  return (
    <Link
      href={`/repos/${row.owner}/${row.name}`}
      className="card block hover:border-[color:var(--accent)]"
      style={cardStyle}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span
            className="display text-2xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <HighlightedName
              owner={row.owner}
              name={row.name}
              highlight={highlight}
            />
          </span>
          <VisibilityBadge value={row.visibility} />
        </div>
        {row.latestRun ? <BuildStatus run={row.latestRun} /> : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p
          className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-faint)]"
          style={{ fontFamily: "var(--font-mono-src)" }}
        >
          default {row.defaultBranch} · created{" "}
          <time
            dateTime={new Date(row.createdAt).toISOString()}
            title={formatAbsoluteIso(row.createdAt)}
          >
            {formatRelativeTime(row.createdAt)}
          </time>
        </p>
        {row.livePath ? (
          <span
            className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--accent-deep)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
            title={row.liveUrl ?? undefined}
          >
            live: {row.livePath}
          </span>
        ) : (
          <span
            className="text-[11px] uppercase tracking-[0.16em] text-[color:var(--ink-faint)]"
            style={{ fontFamily: "var(--font-mono-src)" }}
          >
            pages off
          </span>
        )}
      </div>
    </Link>
  );
}

function HighlightedName({
  owner,
  name,
  highlight,
}: {
  owner: string;
  name: string;
  highlight?: string;
}) {
  const full = `${owner}/${name}`;
  if (!highlight) {
    return (
      <>
        {owner}
        <span className="text-[color:var(--ink-faint)]">/</span>
        {name}
      </>
    );
  }
  const lower = full.toLowerCase();
  const start = lower.indexOf(highlight);
  if (start < 0) {
    return (
      <>
        {owner}
        <span className="text-[color:var(--ink-faint)]">/</span>
        {name}
      </>
    );
  }
  const end = start + highlight.length;
  return (
    <>
      {renderSegment(full.slice(0, start))}
      <mark
        className="bg-transparent"
        style={{
          color: "var(--accent-deep)",
          background: "var(--accent-soft)",
          padding: "0 0.08em",
        }}
      >
        {renderSegment(full.slice(start, end))}
      </mark>
      {renderSegment(full.slice(end))}
    </>
  );
}

function renderSegment(text: string) {
  const parts = text.split("/");
  return parts.map((part, i) => (
    <span key={i}>
      {i > 0 ? <span className="text-[color:var(--ink-faint)]">/</span> : null}
      {part}
    </span>
  ));
}

function BuildStatus({ run }: { run: RepoRowData["latestRun"] }) {
  if (!run) return null;
  const tone =
    run.status === "success"
      ? "ok"
      : run.status === "running" || run.status === "queued"
        ? undefined
        : "bad";
  const symbol =
    run.status === "success"
      ? "✓"
      : run.status === "failed" || run.status === "error"
        ? "✗"
        : "·";
  const right =
    run.status === "success"
      ? formatDuration(run.startedAt, run.finishedAt)
      : run.status === "failed"
        ? `exit ${run.exitCode ?? "—"}`
        : run.status;
  return (
    <span
      className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em]"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      <span className="stamp" data-tone={tone}>
        {symbol} {run.status === "success" ? "build" : run.status}
      </span>
      <span className="text-[color:var(--ink-faint)]">{right}</span>
    </span>
  );
}

function VisibilityBadge({ value }: { value: string }) {
  return (
    <span
      className="stamp"
      data-tone={value === "private" ? "closed" : undefined}
    >
      {value}
    </span>
  );
}

function SortChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      aria-pressed={active}
      className="text-[10px] uppercase tracking-[0.22em]"
      style={{ fontFamily: "var(--font-mono-src)" }}
    >
      {label}
    </Button>
  );
}

function InitialEmptyState({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="card">
      <p
        className="display text-2xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        No repos yet.
      </p>
      <p className="mt-2 text-[color:var(--ink-soft)]">
        {signedIn ? (
          <>
            <Link href="/repos/new" className="link">
              Create your first repo
            </Link>{" "}
            from the form, or run{" "}
            <code className="kbd">npm run seed:demo</code> to populate two
            example sites. The{" "}
            <Link href="/" className="link">
              quickstart on the landing page
            </Link>{" "}
            shows the equivalent <code className="kbd">curl</code> flow.
          </>
        ) : (
          <>
            <Link href="/login" className="link">
              Sign in
            </Link>{" "}
            to create one from the dashboard, or run{" "}
            <code className="kbd">npm run seed:demo</code> to populate two
            example sites.
          </>
        )}
      </p>
    </div>
  );
}

function FilterEmptyState({
  filter,
  onClear,
  signedIn,
}: {
  filter: string;
  onClear: () => void;
  signedIn: boolean;
}) {
  return (
    <div className="card">
      <p
        className="display text-2xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        No matches for <em>{filter}</em>.
      </p>
      <p className="mt-2 text-[color:var(--ink-soft)]">
        Try a shorter substring, or{" "}
        <Button
          type="button"
          variant="link"
          onClick={onClear}
          className="link h-auto p-0"
        >
          clear the filter
        </Button>
        .{" "}
        {signedIn ? (
          <>
            You can also{" "}
            <Link href="/repos/new" className="link">
              create a new repo
            </Link>
            .
          </>
        ) : (
          <>
            <Link href="/login" className="link">
              Sign in
            </Link>{" "}
            to create a new one.
          </>
        )}
      </p>
    </div>
  );
}

function groupByOwner(
  rows: RepoRowData[],
  sort: SortMode,
): {
  owner: string;
  ownerIsOrg: boolean;
  rows: RepoRowData[];
  liveCount: number;
}[] {
  const map = new Map<string, RepoRowData[]>();
  for (const row of rows) {
    const list = map.get(row.owner);
    if (list) list.push(row);
    else map.set(row.owner, [row]);
  }
  const entries = [...map.entries()].map(([owner, ownerRows]) => {
    const ownerIsOrg = ownerRows[0]?.ownerIsOrg ?? false;
    const liveCount = ownerRows.filter((r) => r.pagesLive).length;
    return { owner, ownerIsOrg, rows: ownerRows, liveCount };
  });
  if (sort === "alpha") {
    entries.sort((a, b) => {
      if (a.ownerIsOrg !== b.ownerIsOrg) return a.ownerIsOrg ? -1 : 1;
      return a.owner.localeCompare(b.owner);
    });
  } else {
    entries.sort((a, b) => {
      const aMax = Math.max(...a.rows.map((r) => r.activityAt));
      const bMax = Math.max(...b.rows.map((r) => r.activityAt));
      return bMax - aMax;
    });
  }
  return entries;
}
