import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { getDb } from "@/lib/registry/db";
import { getEnv } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Readiness probe. Returns 200 only when every dependency the bridge
 * actually needs to serve a push is reachable:
 *
 *   - registry SQLite (`SELECT 1`)
 *   - `git` is on PATH (the CGI / hook installer / publisher all shell out)
 *   - the pod base URL serves its OIDC discovery doc (10s in-memory cache
 *     so this endpoint doesn't hammer CSS)
 *   - if `MIND_RUNNER=docker`, the Docker daemon is reachable
 *
 * Returns 503 with per-check status when any of those fail. Liveness is
 * a separate route at `/api/livez` (process up).
 */
type CheckResult = {
  ok: boolean;
  latencyMs: number;
  detail?: string;
};

type CachedOidc = { at: number; ok: boolean; detail?: string };
let oidcCache: CachedOidc | null = null;
const OIDC_CACHE_MS = 10_000;

async function checkRegistry(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const row = getDb().prepare("SELECT 1 AS one").get() as { one: number } | undefined;
    if (!row || row.one !== 1) {
      return { ok: false, latencyMs: Date.now() - start, detail: "SELECT 1 returned no row" };
    }
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, detail: (e as Error).message };
  }
}

function checkGitBinary(): Promise<CheckResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn("git", ["--version"], { stdio: "ignore" });
    child.on("error", (err) =>
      resolve({ ok: false, latencyMs: Date.now() - start, detail: err.message }),
    );
    child.on("close", (code) =>
      resolve({
        ok: code === 0,
        latencyMs: Date.now() - start,
        detail: code === 0 ? undefined : `git --version exited ${code}`,
      }),
    );
  });
}

async function checkPodOidc(podBaseUrl: string): Promise<CheckResult> {
  const start = Date.now();
  if (oidcCache && Date.now() - oidcCache.at < OIDC_CACHE_MS) {
    return {
      ok: oidcCache.ok,
      latencyMs: 0,
      detail: oidcCache.detail ?? "(cached)",
    };
  }
  try {
    const url = `${podBaseUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(3_000) });
    const ok = res.ok;
    oidcCache = { at: Date.now(), ok, detail: ok ? undefined : `${res.status} ${res.statusText}` };
    return { ok, latencyMs: Date.now() - start, detail: oidcCache.detail };
  } catch (e) {
    oidcCache = { at: Date.now(), ok: false, detail: (e as Error).message };
    return { ok: false, latencyMs: Date.now() - start, detail: oidcCache.detail };
  }
}

function checkDocker(): Promise<CheckResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn("docker", ["info", "--format", "{{.ServerVersion}}"], {
      stdio: "ignore",
    });
    child.on("error", (err) =>
      resolve({ ok: false, latencyMs: Date.now() - start, detail: err.message }),
    );
    child.on("close", (code) =>
      resolve({
        ok: code === 0,
        latencyMs: Date.now() - start,
        detail: code === 0 ? undefined : `docker info exited ${code}`,
      }),
    );
  });
}

export async function GET() {
  const env = getEnv();
  const checks: Record<string, CheckResult> = {};

  const [registry, git, pod] = await Promise.all([
    checkRegistry(),
    checkGitBinary(),
    checkPodOidc(env.podBaseUrl),
  ]);
  checks.registry = registry;
  checks.git = git;
  checks.pod = pod;

  if (env.mindRunner === "docker") {
    checks.docker = await checkDocker();
  }

  const ok = Object.values(checks).every((c) => c.ok);
  const status = ok ? 200 : 503;
  return NextResponse.json(
    {
      ok,
      service: "mind-codespaces-v0",
      ts: new Date().toISOString(),
      checks,
    },
    { status },
  );
}
