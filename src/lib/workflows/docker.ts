import "server-only";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

/**
 * Docker-backed sandboxing for workflow `run:` commands. Step 2a of the
 * roadmap in docs/WORKFLOWS-PLAN.md.
 *
 * Design notes:
 *   - One container per workflow (not per command), so `node_modules`
 *     and the like persist between `npm ci` and `npm run build`.
 *   - The container runs as the host UID/GID so the publish step (which
 *     runs back on the host, after the container exits) can read the
 *     produced output directly without a chown pass.
 *   - Network stays on. `npm ci` needs it; an offline / mirror story is
 *     step 2b. The sandbox property we get from step 2a is "the build
 *     can't trash the host filesystem", not "the build can't reach the
 *     internet". Document explicitly.
 *   - Auto-fallback: if Docker isn't available, the runner switches to
 *     native (sh -c) so the prototype keeps working on a fresh machine
 *     without Docker Desktop. Operator can force either with the
 *     MIND_RUNNER env var.
 */

const DEFAULT_IMAGE = "node:22-alpine";
const DOCKER_PROBE_TIMEOUT_MS = 3000;

// Network isolation for the workflow container (§3.4):
//   • MIND_WORKFLOW_NETWORK unset → "none" (no egress at all)
//   • MIND_WORKFLOW_NETWORK="bridge" → host's default bridge (legacy, for
//     dev convenience — `npm ci` works against the public registry)
//   • MIND_WORKFLOW_NETWORK="${user-defined network}" → join that network,
//     where the operator has provisioned a Verdaccio mirror. Combined
//     with MIND_NPM_REGISTRY this gives the build npm access without
//     touching the open internet.
const NETWORK_MODE = (() => {
  const raw = process.env.MIND_WORKFLOW_NETWORK?.trim();
  return raw && raw.length > 0 ? raw : "none";
})();
const NPM_REGISTRY = process.env.MIND_NPM_REGISTRY?.trim() || null;

// Cap on the captured log per workflow. A `printf` bomb (or a build
// that emits a few hundred MB of debug output) would OOM the bridge
// process holding the log buffer. Truncate as we go.
const LOG_CAPTURE_LIMIT = (() => {
  const raw = process.env.MIND_WORKFLOW_LOG_LIMIT;
  const n = raw ? Number(raw) : 5 * 1024 * 1024;
  return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024;
})();

let dockerAvailableCache: boolean | null = null;

/**
 * Probe whether `docker info` succeeds. Result is cached for the lifetime
 * of the process so this only hits Docker once. A process restart
 * re-probes — fine, runners are long-lived dev processes.
 */
export async function isDockerAvailable(): Promise<boolean> {
  if (dockerAvailableCache !== null) return dockerAvailableCache;
  dockerAvailableCache = await new Promise<boolean>((resolveFn) => {
    const child = spawn("docker", ["info", "--format", "{{.ServerVersion}}"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolveFn(false);
    }, DOCKER_PROBE_TIMEOUT_MS);
    timer.unref();
    child.on("error", () => {
      clearTimeout(timer);
      resolveFn(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveFn(code === 0);
    });
  });
  return dockerAvailableCache;
}

export type RunnerMode = "docker" | "native";

/**
 * Resolve which runner the next workflow should use.
 *   MIND_RUNNER=docker  → force docker (errors at runtime if unavailable)
 *   MIND_RUNNER=native  → force native (no sandbox)
 *   (unset / other)     → docker if available, else native
 */
export async function resolveRunnerMode(): Promise<RunnerMode> {
  const env = process.env.MIND_RUNNER?.toLowerCase();
  if (env === "docker") return "docker";
  if (env === "native") return "native";
  return (await isDockerAvailable()) ? "docker" : "native";
}

export type ShellBatchResult = {
  /** Combined stdout + stderr in wallclock order, with per-step banners. */
  log: string;
  /** Exit code of the failing command (under `set -e`), or 0. */
  exitCode: number;
};

/**
 * Execute `commands` sequentially inside one shell (native) or one
 * container (docker). `set -e` stops on the first non-zero exit so the
 * returned `exitCode` is the failing command's code.
 *
 * Per-command banners (`$ npm ci`) are emitted via `printf` inside the
 * shell so both modes produce identical-looking logs.
 */
export async function runShellBatch(input: {
  commands: string[];
  cwd: string;
  timeoutMs: number;
  mode: RunnerMode;
  image?: string;
}): Promise<ShellBatchResult> {
  const script = buildShellScript(input.commands);

  if (input.mode === "native") {
    return runProcess({
      cmd: "sh",
      args: ["-c", script],
      cwd: input.cwd,
      timeoutMs: input.timeoutMs,
    });
  }

  // Docker mode. Name the container so timeout-cleanup can `docker kill`
  // it directly — `--rm` then guarantees disposal even if the docker CLI
  // didn't propagate the signal in time.
  const image = input.image ?? DEFAULT_IMAGE;
  const containerName = `mind-runner-${randomBytes(6).toString("hex")}`;
  const uid = process.getuid?.() ?? 0;
  const gid = process.getgid?.() ?? 0;
  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--init",
    "-v",
    `${input.cwd}:/work`,
    "-w",
    "/work",
    "--user",
    `${uid}:${gid}`,
    "-e",
    "HOME=/tmp",
    "-e",
    "CI=1",
    "--memory=2g",
    "--cpus=2",
    // §3.4 network isolation. Default `none` (no egress); operator can
    // join the container to a user-defined network where Verdaccio
    // lives by setting MIND_WORKFLOW_NETWORK.
    `--network=${NETWORK_MODE}`,
    // Defense-in-depth (the workflows runner shares many of these with
    // the coder driver but they're not blanket-set on the host's `docker
    // run` defaults).
    "--read-only",
    "--tmpfs",
    "/tmp:size=512m,exec",
    "--security-opt",
    "no-new-privileges:true",
    "--cap-drop",
    "ALL",
    "--pids-limit=512",
    "--ulimit",
    "nofile=1024:1024",
    ...(NPM_REGISTRY ? ["-e", `npm_config_registry=${NPM_REGISTRY}`] : []),
    image,
    "sh",
    "-c",
    script,
  ];

  return runProcess({
    cmd: "docker",
    args,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
    onTimeout: () => {
      // Belt-and-braces: explicitly kill the named container so `--rm`
      // disposes it even if the docker CLI is slow to propagate signals.
      const killer = spawn("docker", ["kill", containerName], {
        stdio: "ignore",
      });
      killer.on("error", () => {
        /* nothing useful to do — container may already be gone */
      });
    },
  });
}

/**
 * Compose the shell script that the runner executes (inside `sh -c`,
 * either on the host or inside the container). `set -e` mirrors CI
 * semantics: first failure stops the batch. Each command is preceded by
 * a `printf` banner so the captured log shows step boundaries.
 */
function buildShellScript(commands: string[]): string {
  const lines = ["set -e"];
  for (const cmd of commands) {
    // `printf` (not `echo`) so commands starting with `-` don't get
    // misinterpreted as flags. Single-quoted form keeps the user's
    // command intact in the banner.
    lines.push(`printf '\\n$ %s\\n' ${shSingleQuote(cmd)}`);
    lines.push(cmd);
  }
  return lines.join("\n");
}

/**
 * POSIX single-quote escape: every literal `'` becomes `'\''` (close,
 * escaped quote, reopen). Always safe to wrap the result in single
 * quotes.
 */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function runProcess(input: {
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  onTimeout?: () => void;
}): Promise<ShellBatchResult> {
  return new Promise((resolveFn) => {
    const child = spawn(input.cmd, input.args, { cwd: input.cwd });
    let log = "";
    let truncated = false;
    const appendCapped = (chunk: string) => {
      if (truncated) return;
      const remaining = LOG_CAPTURE_LIMIT - log.length;
      if (remaining <= 0) {
        log += `\n[log truncated at ${LOG_CAPTURE_LIMIT} bytes]\n`;
        truncated = true;
        return;
      }
      if (chunk.length > remaining) {
        log += chunk.slice(0, remaining);
        log += `\n[log truncated at ${LOG_CAPTURE_LIMIT} bytes]\n`;
        truncated = true;
      } else {
        log += chunk;
      }
    };
    child.stdout.on("data", (d: Buffer) => appendCapped(d.toString()));
    child.stderr.on("data", (d: Buffer) => appendCapped(d.toString()));
    const timer = setTimeout(() => {
      log += `\n[timed out after ${input.timeoutMs}ms — sending SIGTERM]\n`;
      input.onTimeout?.();
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, input.timeoutMs);
    timer.unref();
    child.on("error", (err) => {
      clearTimeout(timer);
      log += `\n[spawn error: ${err.message}]\n`;
      resolveFn({ log, exitCode: -1 });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolveFn({ log, exitCode: exitCode ?? -1 });
    });
  });
}
