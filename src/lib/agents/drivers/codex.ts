import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentEvent, Driver } from "@/lib/agents/types";
import { getRepo, validateName, type Repo } from "@/lib/registry/repos";
import {
  addComment,
  getIssueByNumber,
  listComments,
  setCommentPodUrl,
  type Issue,
  type IssueComment,
} from "@/lib/registry/issues";
import { commentUrl, writeCommentToPod } from "@/lib/solid/issues";
import { upsertPullRequest } from "@/lib/registry/pulls";
import { STATIC_EXPORT_RULES } from "@/lib/agents/prompt-fragments";

/**
 * Codex driver (PoC). A sibling of the `coder` (opencode) driver that
 * runs OpenAI's `codex exec` non-interactively against a clone of the
 * issue's repo. opencode / Claude Code / Codex are interchangeable CLI
 * agent harnesses, so this driver reuses the same clone → branch-resume
 * → run → inspect → commit/PR (or ASK-comment) shape; only the agent
 * invocation differs.
 *
 * Two runtimes, selected by MIND_CODEX_RUNTIME:
 *
 *   • host  — run `codex exec` directly on the bridge host, using the
 *     device's existing `~/.codex/auth.json` (ChatGPT login). No API key,
 *     no per-token cost. Codex's own OS sandbox (`-s workspace-write`)
 *     still applies. Device-bound: only works where codex + login exist.
 *     This is the default and the dev path.
 *   • docker — run `codex exec` inside a hardened container
 *     (MIND_CODEX_IMAGE), authed by OPENAI_API_KEY forwarded into the
 *     container. The container is the sandbox, so we pass
 *     `--dangerously-bypass-approvals-and-sandbox`. This is the prod path.
 *   • auto  — docker if MIND_CODEX_IMAGE is set AND `docker info` succeeds,
 *     else host.
 *
 * Unlike `coder`, this driver is NOT wired to any auto-triggered role; it
 * is invoked by passing `driver: "codex"` to POST /api/agents/dispatch, so
 * it can be exercised side-by-side with `coder` without double-firing.
 *
 * Env:
 *   MIND_CODEX_RUNTIME  — host | docker | auto (default host)
 *   MIND_CODEX_IMAGE    — container image for the docker runtime
 *                         (default mind-codespaces/codex:latest)
 *   MIND_CODEX_MODEL    — optional model id passed as `-m`. Omit to use
 *                         Codex's configured default (~/.codex/config.toml).
 *   MIND_CODEX_TIMEOUT  — seconds before the run is killed (default 600)
 *   MIND_CODEX_NETWORK  — docker network for the docker runtime (default "bridge")
 *   MIND_CODER_WORKROOT — parent dir for per-run checkouts (shared with coder)
 *   GIT_DATA_DIR        — bare repo storage (shared with the bridge)
 */

const DEFAULT_IMAGE = "mind-codespaces/codex:latest";
const DEFAULT_TIMEOUT_S = 600;
const GIT_DATA_DIR =
  process.env.GIT_DATA_DIR ?? path.join(process.cwd(), ".git-data/repos");
const WORK_ROOT = process.env.MIND_CODER_WORKROOT ?? os.tmpdir();
const AGENT_COMMENT_REL = ".mind/agent-comment.md";
const AGENT_WEBID = "mind:agent:codex";

/** Scratch dirs that must never count as a real code change or land in a commit. */
const AGENT_SCRATCH_DIRS = [".mind", ".playwright-mcp"];

type SupportedEvent = Extract<
  AgentEvent,
  { type: "issue.created" | "issue.labeled" | "issue.commented" }
>;

function isSupported(event: AgentEvent): event is SupportedEvent {
  return (
    event.type === "issue.created" ||
    event.type === "issue.labeled" ||
    event.type === "issue.commented"
  );
}

type Runtime = "host" | "docker";

async function resolveRuntime(): Promise<Runtime> {
  const raw = (process.env.MIND_CODEX_RUNTIME ?? "host").toLowerCase();
  if (raw === "host") return "host";
  if (raw === "docker") return "docker";
  // auto: docker only if an image is configured and the daemon answers.
  if (!process.env.MIND_CODEX_IMAGE) return "host";
  const probe = await sh("docker", ["info"]).catch(() => ({ exit: 1 }) as ShResult);
  return probe.exit === 0 ? "docker" : "host";
}

export const codexDriver: Driver = {
  name: "codex",
  describe() {
    const rt = process.env.MIND_CODEX_RUNTIME ?? "host";
    const model = process.env.MIND_CODEX_MODEL ?? "codex default";
    return `Runs OpenAI \`codex exec\` (runtime=${rt}, model=${model}). Decides per run whether to open a PR or post a clarifying comment.`;
  },
  async run(ctx) {
    if (!isSupported(ctx.event)) {
      return {
        status: "error",
        summary: `codex driver does not handle ${ctx.event.type} events`,
        error: "wrong event type",
      };
    }
    const { repoOwner, repoName, issueNumber } = ctx.event;

    // Defense in depth: we shell out and build disk paths from these.
    try {
      validateName(repoOwner, "owner");
      validateName(repoName, "repo");
    } catch (e) {
      return {
        status: "error",
        summary: `codex refused: invalid repo identity (${(e as Error).message})`,
        error: "invalid name",
      };
    }

    const repo = getRepo(repoOwner, repoName);
    if (!repo) {
      return {
        status: "error",
        summary: `repo ${repoOwner}/${repoName} not found in registry`,
        error: "no repo",
      };
    }
    const issue = getIssueByNumber(repo.id, issueNumber);
    if (!issue) {
      return {
        status: "error",
        summary: `issue #${issueNumber} not found on ${repoOwner}/${repoName}`,
        error: "no issue",
      };
    }

    const runtime = await resolveRuntime();
    const image = process.env.MIND_CODEX_IMAGE ?? DEFAULT_IMAGE;
    const timeoutS = Number(process.env.MIND_CODEX_TIMEOUT ?? DEFAULT_TIMEOUT_S);
    const model = process.env.MIND_CODEX_MODEL?.trim() || null;
    const modelLabel = model ?? "codex default";

    if (runtime === "docker" && !process.env.OPENAI_API_KEY) {
      return {
        status: "error",
        summary:
          "codex docker runtime needs OPENAI_API_KEY on the bridge " +
          "(host runtime uses the device's ~/.codex login instead).",
        error: "no OPENAI_API_KEY",
      };
    }

    const comments = listComments(issue.id);

    await fs.mkdir(WORK_ROOT, { recursive: true });
    const workDir = await fs.mkdtemp(
      path.join(WORK_ROOT, `mind-codex-${repoName}-${issueNumber}-`),
    );
    const logStream = await openLogStream(ctx.logPath);
    const log = (line: string) => {
      if (logStream) logStream.write(`${line}\n`);
    };
    const summaryLines: string[] = [];
    try {
      log(
        `[codex] start ${repoOwner}/${repoName}#${issueNumber} ` +
          `(runtime=${runtime} model=${modelLabel}` +
          (runtime === "docker" ? ` image=${image}` : "") +
          `)`,
      );
      if (comments.length > 0) {
        log(`[codex] including ${comments.length} prior comment(s) in prompt`);
      }

      // 1. Clone the bare repo so codex has a real working tree.
      const barePath = path.join(GIT_DATA_DIR, repoOwner, `${repoName}.git`);
      log(`[codex] git clone ${barePath} -> ${workDir}`);
      const clone = await sh("git", ["clone", barePath, workDir], { logStream });
      if (clone.exit !== 0) {
        return errorResult(
          `git clone of ${barePath} failed (exit ${clone.exit})`,
          clone.stderr.slice(-800),
        );
      }

      // 1a. Resume on the codex branch if a prior run already pushed it,
      // so a follow-up comment iterates on the open PR instead of failing
      // with a non-fast-forward push. Detection uses the local
      // `origin/<branch>` ref the clone populated (no network).
      //
      // NOTE the `-codex` suffix: the opencode `coder` driver commits to
      // `agent/issue-{n}`, so codex deliberately uses a DISTINCT branch.
      // That lets both backends run on the SAME issue without colliding —
      // you get two independent PRs (opencode's vs codex's) on one prompt
      // to compare side-by-side.
      const branch = `agent/issue-${issueNumber}-codex`;
      const branchProbe = await sh("git", [
        "-C",
        workDir,
        "rev-parse",
        "--verify",
        "--quiet",
        `origin/${branch}`,
      ]);
      const branchExists = branchProbe.exit === 0;
      if (branchExists) {
        const co = await sh(
          "git",
          ["-C", workDir, "checkout", "-B", branch, `origin/${branch}`],
          { logStream },
        );
        if (co.exit !== 0) {
          return errorResult(
            `checkout of existing ${branch} failed (exit ${co.exit})`,
            co.stderr.slice(-800),
          );
        }
        log(`[codex] resuming on existing branch ${branch}`);
      }

      // 2. Build the prompt: issue + prior comments + two-mode contract.
      const task = renderTaskPrompt({
        owner: repoOwner,
        repo: repoName,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        comments,
        resumingFrom: branchExists ? branch : null,
      });

      // 3. Run codex.
      const t0 = Date.now();
      let cx: ShResult;
      if (runtime === "host") {
        // Host: the agent's working root IS workDir; codex uses the
        // device's ~/.codex login. workspace-write keeps writes scoped to
        // the checkout; --ephemeral avoids leaving session files behind.
        const args = [
          "exec",
          "-C",
          workDir,
          "-s",
          "workspace-write",
          "--skip-git-repo-check",
          "--ephemeral",
          ...(model ? ["-m", model] : []),
          task,
        ];
        log(`[codex] codex exec (runtime=host, timeout=${timeoutS}s)`);
        cx = await sh("codex", args, { timeoutMs: timeoutS * 1000, logStream });
      } else {
        // Docker: the container is the sandbox, so bypass codex's own
        // approvals/sandbox. OPENAI_API_KEY is forwarded by name only (the
        // value is read from the bridge env at exec time, never on argv);
        // CODEX_HOME points at the writable tmpfs so the entrypoint can
        // materialize auth.json there.
        const uid = os.userInfo().uid;
        const gid = os.userInfo().gid;
        const network = process.env.MIND_CODEX_NETWORK ?? "bridge";
        const dockerArgs = [
          "run",
          "--rm",
          "-v",
          `${workDir}:/work`,
          "--env",
          "OPENAI_API_KEY",
          "--env",
          "HOME=/tmp",
          "--env",
          "CODEX_HOME=/tmp/.codex",
          "--memory=1g",
          "--cpus=1",
          "--pids-limit=256",
          "--ulimit",
          "nofile=1024:1024",
          "--read-only",
          "--tmpfs",
          `/tmp:size=${process.env.MIND_CODER_TMPFS ?? "512m"},exec`,
          "--security-opt",
          "no-new-privileges:true",
          "--cap-drop",
          "ALL",
          "--network",
          network,
          "--user",
          `${uid}:${gid}`,
          image,
          "exec",
          "--dangerously-bypass-approvals-and-sandbox",
          "--skip-git-repo-check",
          "-C",
          "/work",
          ...(model ? ["-m", model] : []),
          task,
        ];
        log(`[codex] docker run (runtime=docker, timeout=${timeoutS}s, network=${network})`);
        cx = await sh("docker", dockerArgs, {
          timeoutMs: timeoutS * 1000,
          logStream,
        });
      }
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      log(`[codex] exit=${cx.exit} (${elapsed}s)`);
      const cxTail = (cx.stdout + (cx.stderr ? `\n[stderr]\n${cx.stderr}` : "")).slice(
        -2000,
      );
      summaryLines.push(`codex exit=${cx.exit} (runtime=${runtime}, model=${modelLabel}, ${elapsed}s)`);

      // 4. Inspect what codex produced.
      //   - no changes at all → error (model went silent / refused)
      //   - only .mind/agent-comment.md → comment-only (ASK) path
      //   - code changes → PR path
      const status = await sh("git", [
        "-C",
        workDir,
        "status",
        "--porcelain",
        "-uall",
      ]);
      const dirty = status.stdout.trimEnd();
      const commentBody = await readAgentCommentFile(workDir);
      const wantsComment = commentBody !== null;

      if (!dirty || (parsePorcelain(dirty).filter(isCodeChange).length === 0 && !wantsComment)) {
        log(`[codex] no code changes or comment; aborting`);
        return {
          status: "error",
          summary: [
            `codex produced no file changes for #${issueNumber}.`,
            "",
            "--- codex output (last 2000 chars) ---",
            cxTail,
          ].join("\n"),
          error: cx.exit === 0 ? "no changes" : `codex exit ${cx.exit}`,
          data: { runtime, model: modelLabel, exit: cx.exit },
        };
      }

      const codeChanges = parsePorcelain(dirty).filter(isCodeChange);
      log(
        `[codex] changed files (${codeChanges.length}): ${codeChanges.join(", ")}` +
          (wantsComment ? " [+agent-comment.md]" : ""),
      );

      // ---- Comment-only (ASK) path ----------------------------------------
      if (wantsComment && codeChanges.length === 0) {
        const posted = await postAgentComment({
          repo,
          issue,
          body: commentBody!,
          agentRunId: ctx.runId,
        });
        log(`[codex] posted clarifying comment #${posted.id}`);
        return {
          status: "ok",
          summary: [
            `Posted a clarifying comment on #${issueNumber} (no code changes).`,
            "",
            "--- comment ---",
            truncate(commentBody!, 800),
          ].join("\n"),
          data: {
            mode: "comment",
            commentId: posted.id,
            runtime,
            model: modelLabel,
            exit: cx.exit,
          },
        };
      }

      // ---- PR path (with optional accompanying comment) -------------------
      summaryLines.push(`changed files (${codeChanges.length}): ${codeChanges.join(", ")}`);

      // Drop agent-scratch before committing, but PRESERVE .mind/workflow.yml
      // (the build recipe). Remove only the known scratch artifacts.
      await fs
        .rm(path.join(workDir, ".playwright-mcp"), { recursive: true, force: true })
        .catch(() => {});
      await fs
        .rm(path.join(workDir, AGENT_COMMENT_REL), { force: true })
        .catch(() => {});

      const steps: Array<[string, string[]]> = [
        ["config", ["-C", workDir, "config", "user.email", AGENT_WEBID]],
        ["config", ["-C", workDir, "config", "user.name", "mind-codespaces codex"]],
        ...(branchExists
          ? []
          : ([["checkout", ["-C", workDir, "checkout", "-b", branch]]] as Array<
              [string, string[]]
            >)),
        ["add", ["-C", workDir, "add", "-A"]],
        [
          "commit",
          [
            "-C",
            workDir,
            "commit",
            "-m",
            branchExists
              ? `[codex] iterate on #${issueNumber}: ${issue.title}\n\nFollow-up from codex (model ${modelLabel}).`
              : `[codex] solve #${issueNumber}: ${issue.title}\n\nGenerated by codex (model ${modelLabel}).`,
          ],
        ],
        ["push", ["-C", workDir, "push", "origin", branch]],
      ];
      for (const [label, args] of steps) {
        const r = await sh("git", args, { logStream });
        if (r.exit !== 0) {
          return errorResult(
            `git ${label} failed (exit ${r.exit})`,
            r.stderr.slice(-800),
          );
        }
      }
      log(`[codex] pushed branch ${branch} to ${repoOwner}/${repoName}`);

      const sourceSha = (await sh("git", ["-C", workDir, "rev-parse", "HEAD"]))
        .stdout.trim();
      const prBody = [
        `Generated by the codex driver (\`codex exec\`, runtime \`${runtime}\`, model \`${modelLabel}\`).`,
        "",
        `Changed files (${codeChanges.length}):`,
        ...codeChanges.map((f) => `- \`${f}\``),
      ].join("\n");
      const pull = upsertPullRequest({
        repoId: repo.id,
        title: `Solve #${issueNumber}: ${issue.title}`,
        body: prBody,
        sourceBranch: branch,
        targetBranch: repo.defaultBranch,
        sourceSha,
        issueId: issue.id,
      });
      log(`[codex] opened pull request #${pull.number}`);

      if (wantsComment) {
        const noteBody = [
          commentBody!.trim(),
          "",
          `_Opened pull request **#${pull.number}** (\`${branch}\` → \`${repo.defaultBranch}\`) with this work._`,
        ].join("\n");
        const posted = await postAgentComment({
          repo,
          issue,
          body: noteBody,
          agentRunId: ctx.runId,
        });
        log(`[codex] posted PR-accompanying comment #${posted.id}`);
      }

      return {
        status: "ok",
        summary: [
          `Opened pull #${pull.number} (${branch} → ${repo.defaultBranch}).`,
          `Changed files (${codeChanges.length}):`,
          ...codeChanges.map((f) => `  - ${f}`),
          "",
          "--- codex output (last 800 chars) ---",
          cxTail.slice(-800),
        ].join("\n"),
        data: {
          mode: "pr",
          branch,
          files: codeChanges,
          runtime,
          model: modelLabel,
          exit: cx.exit,
          pullNumber: pull.number,
        },
      };
    } catch (err) {
      log(`[codex] crash: ${err instanceof Error ? err.message : String(err)}`);
      return {
        status: "error",
        summary: [
          `codex driver crashed: ${err instanceof Error ? err.message : String(err)}`,
          summaryLines.length > 0
            ? `Progress before crash: ${summaryLines.join("; ")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (logStream) {
        await new Promise<void>((res) => logStream.end(res));
      }
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  },
};

/** A changed path is "real" unless it lives in an agent scratch dir. */
function isCodeChange(f: string): boolean {
  return !AGENT_SCRATCH_DIRS.some((d) => f === d || f.startsWith(`${d}/`));
}

function renderTaskPrompt(input: {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  comments: IssueComment[];
  resumingFrom: string | null;
}): string {
  const conversation =
    input.comments.length > 0
      ? [
          "",
          `--- Conversation so far (${input.comments.length} comment(s)) ---`,
          ...input.comments.map((c, i) => {
            const who =
              c.agentRunId !== null ? "codex (you, earlier)" : c.authorWebId;
            return [`[${i + 1}] ${who}:`, c.body.trim(), ""].join("\n");
          }),
          "--- End of conversation ---",
          "",
        ].join("\n")
      : "";

  const resumeNote = input.resumingFrom
    ? [
        "",
        `NOTE: this is a continuation. The working tree is already at the`,
        `tip of branch \`${input.resumingFrom}\` — your previous attempt's`,
        `commits are already applied. Treat the conversation above as a`,
        `follow-up: build on what's there and only edit what the next`,
        `iteration requires. If everything asked for is already present,`,
        `write \`.mind/agent-comment.md\` saying so and make no file changes.`,
        "",
      ].join("\n")
    : "";

  return [
    `You are the Codex coding agent for the ${input.owner}/${input.repo} repository.`,
    "",
    `Issue #${input.number}: ${input.title}`,
    "",
    input.body || "(no description provided)",
    conversation,
    resumeNote,
    "DECIDE ONE OF TWO MODES.",
    "",
    "Mode A — IMPLEMENT: if the issue is clear enough, edit the smallest",
    "set of files needed to resolve it. Do not create unrelated files.",
    "Your changes will be committed to a branch and opened as a PR.",
    "",
    "Mode B — ASK: if the issue is ambiguous, you need a decision from the",
    "user, or you want to propose a plan before writing code, write your",
    "plan + the specific questions to the file `.mind/agent-comment.md`",
    "(Markdown) and make NO other file changes. That file is posted as a",
    "comment on the issue and the next user reply re-triggers you with the",
    "full conversation.",
    "",
    "You may do both — write `.mind/agent-comment.md` AND edit code — to",
    "implement now while leaving a note explaining your reasoning.",
    "",
    "PRESERVE THE PROJECT STRUCTURE.",
    "",
    "If this is a build-based app (a `package.json` with a build script",
    "and/or a `.mind/workflow.yml` — e.g. Vite / React / Tailwind), edit",
    "only the source files (usually under `src/`). Do NOT convert it into a",
    "single hand-written static HTML file, and do NOT delete, move, or",
    "rewrite `vite.config.*`, `package.json`, the `<script>` tag in",
    "`index.html`, `src/main.*`, or `.mind/workflow.yml`. Do NOT commit",
    "`dist/` or `node_modules/`. The platform runs the build and publishes",
    "the output for you — breaking the build setup means nothing ships.",
    "",
    STATIC_EXPORT_RULES,
    "",
    "Make your edits directly in the working tree. Do NOT run `git commit`,",
    "`git push`, or open a PR yourself — the platform commits your changes,",
    "opens the PR, and strips scratch dirs (`.mind/`, `.playwright-mcp/`)",
    "before committing.",
  ].join("\n");
}

async function readAgentCommentFile(workDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(workDir, AGENT_COMMENT_REL), "utf-8");
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

async function postAgentComment(input: {
  repo: Repo;
  issue: Issue;
  body: string;
  agentRunId: number | null;
}): Promise<IssueComment> {
  const comment = addComment({
    issueId: input.issue.id,
    authorWebId: AGENT_WEBID,
    body: input.body,
    podUrl: "pending",
    agentRunId: input.agentRunId,
  });
  const canonical = commentUrl(input.repo, input.issue.number, comment.id);
  setCommentPodUrl(comment.id, canonical);
  comment.podUrl = canonical;
  writeCommentToPod(input.repo, input.issue.number, comment).catch((err) => {
    console.warn(
      `[codex] writeCommentToPod for ${input.repo.owner}/${input.repo.name}#${input.issue.number} failed:`,
      err,
    );
  });
  return comment;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function errorResult(message: string, detail: string) {
  return {
    status: "error" as const,
    summary: `${message}\n\n${detail}`,
    error: message,
  };
}

/** Parse `git status --porcelain` output into bare filenames (dest for renames). */
function parsePorcelain(out: string): string[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const arrow = l.indexOf(" -> ");
      if (arrow >= 0 && /^.{2}\s/.test(l)) {
        return unquotePath(l.slice(arrow + 4));
      }
      const positional = l.length > 3 ? l.slice(3) : "";
      if (positional.length > 0 && !/^\s/.test(positional)) {
        return unquotePath(positional);
      }
      const stripped = l.replace(/^[A-Z?!\s]+/, "");
      return unquotePath(stripped || l);
    });
}

function unquotePath(p: string): string {
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) {
    try {
      return JSON.parse(p) as string;
    } catch {
      return p.slice(1, -1);
    }
  }
  return p;
}

async function openLogStream(
  logPath: string | null,
): Promise<WriteStream | null> {
  if (!logPath) return null;
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  return createWriteStream(logPath, { flags: "a" });
}

type ShResult = { exit: number; stdout: string; stderr: string };

function sh(
  cmd: string,
  args: string[],
  opts: {
    timeoutMs?: number;
    logStream?: WriteStream | null;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<ShResult> {
  return new Promise((resolve, reject) => {
    // detached so the timeout path can kill the WHOLE process group
    // (docker run / codex fork helpers; killing only the parent leaks them).
    const child: ChildProcess = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: opts.env ?? process.env,
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let killed = false;
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
      opts.logStream?.write(d);
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      opts.logStream?.write(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exit: killed ? 124 : code ?? 0, stdout, stderr });
    });
    if (opts.timeoutMs) {
      const t = setTimeout(() => {
        killed = true;
        try {
          if (typeof child.pid === "number") process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }, opts.timeoutMs);
      t.unref();
    }
  });
}
