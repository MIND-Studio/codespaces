/**
 * Dependency-free Prometheus metrics registry (§3.1).
 *
 * Exposed at `/metrics` gated on `BRIDGE_METRICS_TOKEN`. We avoid adding
 * `prom-client` because (a) its CJS/ESM dual-package shipping has caused
 * Next.js bundler surprises in this repo before, and (b) the exposition
 * format we need is trivial.
 *
 * Supported metric types:
 *   - counter: monotonically increasing scalar
 *   - gauge:   set/replace
 *   - process defaults: synthesised at scrape time from process.memoryUsage()
 *
 * Histograms are deliberately omitted for now — operators that need
 * latency distributions can compute them in Grafana from request log
 * NDJSON until histograms grow into the registry.
 */

type Labels = Record<string, string | number>;

type MetricEntry = {
  type: "counter" | "gauge";
  help: string;
  series: Map<string, number>; // serialized label key → value
};

const registry = new Map<string, MetricEntry>();

function serialiseLabels(labels?: Labels): string {
  if (!labels) return "";
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return keys.map((k) => `${k}="${String(labels[k]).replace(/[\\"\n]/g, "_")}"`).join(",");
}

function ensureEntry(name: string, type: "counter" | "gauge", help: string): MetricEntry {
  const existing = registry.get(name);
  if (existing) return existing;
  const entry: MetricEntry = { type, help, series: new Map() };
  registry.set(name, entry);
  return entry;
}

export function incrementCounter(name: string, help: string, labels?: Labels, value = 1): void {
  const entry = ensureEntry(name, "counter", help);
  const key = serialiseLabels(labels);
  entry.series.set(key, (entry.series.get(key) ?? 0) + value);
}

export function setGauge(
  name: string,
  help: string,
  labels: Labels | undefined,
  value: number,
): void {
  const entry = ensureEntry(name, "gauge", help);
  entry.series.set(serialiseLabels(labels), value);
}

export function renderExposition(): string {
  const out: string[] = [];
  for (const [name, entry] of registry) {
    out.push(`# HELP ${name} ${entry.help}`);
    out.push(`# TYPE ${name} ${entry.type}`);
    for (const [labels, value] of entry.series) {
      if (labels) out.push(`${name}{${labels}} ${value}`);
      else out.push(`${name} ${value}`);
    }
  }
  // Append default process metrics. Cheap (one syscall each).
  const mem = process.memoryUsage();
  out.push(`# HELP nodejs_memory_heap_used_bytes Process heap used`);
  out.push(`# TYPE nodejs_memory_heap_used_bytes gauge`);
  out.push(`nodejs_memory_heap_used_bytes ${mem.heapUsed}`);
  out.push(`# HELP nodejs_memory_rss_bytes Process resident set size`);
  out.push(`# TYPE nodejs_memory_rss_bytes gauge`);
  out.push(`nodejs_memory_rss_bytes ${mem.rss}`);
  out.push(`# HELP nodejs_uptime_seconds Process uptime`);
  out.push(`# TYPE nodejs_uptime_seconds gauge`);
  out.push(`nodejs_uptime_seconds ${process.uptime()}`);
  return out.join("\n") + "\n";
}

// Convenience wrappers for the named series the bridge tracks.
export const Metrics = {
  gitPush(
    owner: string,
    repo: string,
    result: "success" | "auth-failed" | "rate-limited" | "quota-exceeded" | "error",
  ): void {
    incrementCounter("git_pushes_total", "Total git push attempts.", {
      owner,
      repo,
      result,
    });
  },
  gitClone(owner: string, repo: string, result: "success" | "auth-failed" | "error"): void {
    incrementCounter("git_clones_total", "Total git clone attempts.", {
      owner,
      repo,
      result,
    });
  },
  publishOk(owner: string, repo: string): void {
    incrementCounter("publish_total", "Successful Pages publishes.", {
      owner,
      repo,
      result: "success",
    });
  },
  publishFailed(owner: string, repo: string, reason: string): void {
    incrementCounter("publish_failures_total", "Failed Pages publishes.", {
      owner,
      repo,
      reason,
    });
  },
  workflowRun(status: "success" | "failed" | "error"): void {
    incrementCounter("workflow_runs_total", "Workflow run outcomes.", {
      status,
    });
  },
  agentCall(driver: string, role: string, result: "ok" | "error"): void {
    incrementCounter("agent_calls_total", "Agent driver calls.", {
      driver,
      role,
      result,
    });
  },
  authFailed(scope: string): void {
    incrementCounter("auth_failures_total", "Authentication failures.", {
      scope,
    });
  },
};
