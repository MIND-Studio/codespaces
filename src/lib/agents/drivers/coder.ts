import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import { createWriteStream, type WriteStream } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentEvent, Driver } from "@/lib/agents/types";
import { getRepo, type Repo } from "@/lib/registry/repos";
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
import { validateName } from "@/lib/registry/repos";
import { getOwnerFetch } from "@/lib/solid/fetch-for-owner";
import { ensureContainer, setPublicReadAcl } from "@/lib/solid/containers";
import { resolveCoderConfig } from "@/lib/ai-providers/store";
import { AGENT_LOGS_DIR } from "@/lib/agents/dispatch";
import {
  PROVIDERS,
  getProvider,
  formatOpencodeModel,
} from "@/lib/ai-providers/providers";

/**
 * Coder driver. Spawns opencode in a docker container against a clone
 * of the issue's repo. Inside the container the agent decides between
 * two outputs:
 *
 *   • Edit source files → the driver commits to `agent/issue-{n}` and
 *     opens a PR. This is the "implement" path.
 *   • Write `.mind/agent-comment.md` and no source changes → the driver
 *     posts that file as a comment on the issue (Markdown). This is
 *     the "ask / plan" path; the next user comment re-fires the coder
 *     with full conversation context.
 *
 * Both paths can happen on the same run (a comment summarising the PR
 * accompanies the patch).
 *
 * The container is the sandbox — opencode runs with
 * `--dangerously-skip-permissions` but can only touch the bind-mounted
 * /work, can only hit the network through the container bridge, and is
 * killed at process exit.
 *
 * Credentials are resolved per repo owner via resolveCoderConfig:
 * the owner's BYOK key at /profile/ai-providers takes precedence;
 * otherwise the bridge-wide OPENROUTER_API_KEY + MIND_AGENT_MODEL act
 * as a fallback. The resolved key is forwarded into the container under
 * the provider's expected env name(s).
 *
 * Env:
 *   MIND_AGENT_MODEL    — bridge-wide fallback model id (defaults to
 *                         "anthropic/claude-3.5-sonnet"). Only consulted
 *                         when the owner has no BYOK pref.
 *   OPENROUTER_API_KEY  — bridge-wide fallback key (see above).
 *   MIND_CODER_IMAGE    — image tag (defaults to mind-codespaces/coder:latest)
 *   MIND_CODER_TIMEOUT  — seconds before the container is killed (default 600)
 *   MIND_CODER_WORKROOT — parent dir for per-run checkouts (defaults to
 *                         os.tmpdir()). MUST be set when the bridge runs
 *                         inside a container and shells out to the host
 *                         Docker socket: the `-v ${workDir}:/work` bind
 *                         mount is resolved by the host daemon, so workDir
 *                         has to be a path that exists at the same address
 *                         in BOTH the bridge container and on the host.
 *                         The prod compose mounts /var/lib/mind/coder-work
 *                         to the same path on both sides.
 *   GIT_DATA_DIR        — same as elsewhere in the bridge
 */

const DEFAULT_IMAGE = "mind-codespaces/coder:latest";
const DEFAULT_TIMEOUT_S = 600;
const GIT_DATA_DIR =
  process.env.GIT_DATA_DIR ?? path.join(process.cwd(), ".git-data/repos");
const WORK_ROOT = process.env.MIND_CODER_WORKROOT ?? os.tmpdir();
const AGENT_COMMENT_REL = ".mind/agent-comment.md";
const AGENT_SCREENSHOTS_REL = ".mind/screenshots";
const AGENT_WEBID = "mind:agent:coder";

/**
 * Directories the playwright-mcp server / opencode write into /work as
 * scratch and that must NOT end up in the commit. `.mind/` is our own
 * scratch contract; `.playwright-mcp/` is where the MCP server dumps
 * session traces (console-*.log, page-*.yml) on every browser call.
 */
const AGENT_SCRATCH_DIRS = [".mind", ".playwright-mcp"];

/** Files opencode is asked to drop in `.mind/screenshots/` go to the pod
 *  as image attachments and surface in the PR body / comment. Anything
 *  matching this regex is treated as an image. */
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg)$/i;

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

export const coderDriver: Driver = {
  name: "coder",
  describe() {
    return `Runs opencode in docker (image=${process.env.MIND_CODER_IMAGE ?? DEFAULT_IMAGE}). Decides per run whether to open a PR or post a clarifying comment.`;
  },
  async run(ctx) {
    if (!isSupported(ctx.event)) {
      return {
        status: "error",
        summary: `coder driver does not handle ${ctx.event.type} events`,
        error: "wrong event type",
      };
    }
    const { repoOwner, repoName, issueNumber } = ctx.event;

    // Defense in depth: the dispatch route already validated, but the
    // coder driver shells out and builds disk paths from these. Refuse
    // anything that's not a clean owner/repo name regardless of how the
    // event arrived.
    try {
      validateName(repoOwner, "owner");
      validateName(repoName, "repo");
    } catch (e) {
      return {
        status: "error",
        summary: `coder refused: invalid repo identity (${(e as Error).message})`,
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

    // Resolve the (provider, model, apiKey) tuple for this repo's owner.
    // Priority: user's configured pref → bridge-default OPENROUTER env.
    // Returning null means neither path produced a usable config — the
    // owner hasn't BYO'd a key AND the operator hasn't set
    // OPENROUTER_API_KEY on the bridge.
    const config = resolveCoderConfig(repo.ownerWebId);
    if (!config) {
      return {
        status: "error",
        summary:
          `No AI provider configured for ${repo.ownerWebId}. ` +
          "The owner can connect a key at /profile/ai-providers, or the " +
          "operator can set OPENROUTER_API_KEY on the bridge.",
        error: "no provider configured",
      };
    }
    const providerSpec = getProvider(config.provider);
    if (!providerSpec) {
      // Shouldn't happen — resolveCoderConfig only returns known providers.
      return {
        status: "error",
        summary: `unknown provider ${config.provider}`,
        error: "unknown provider",
      };
    }

    const image = process.env.MIND_CODER_IMAGE ?? DEFAULT_IMAGE;
    const timeoutS = Number(process.env.MIND_CODER_TIMEOUT ?? DEFAULT_TIMEOUT_S);
    const orModel = config.model;
    const fullModelArg = formatOpencodeModel(providerSpec, config.model);

    const comments = listComments(issue.id);

    // Ensure the work root exists before mkdtemp (os.tmpdir() always does;
    // a custom MIND_CODER_WORKROOT on a fresh deploy may not).
    await fs.mkdir(WORK_ROOT, { recursive: true });
    const workDir = await fs.mkdtemp(
      path.join(WORK_ROOT, `mind-coder-${repoName}-${issueNumber}-`),
    );
    const logStream = await openLogStream(ctx.logPath);
    const log = (line: string) => {
      if (logStream) logStream.write(`${line}\n`);
    };
    const summaryLines: string[] = [];
    try {
      log(
        `[coder] start ${repoOwner}/${repoName}#${issueNumber} ` +
          `(provider=${config.provider} source=${config.source} model=${orModel} ` +
          `image=${image})`,
      );
      if (comments.length > 0) {
        log(`[coder] including ${comments.length} prior comment(s) in prompt`);
      }

      // 1. Clone the bare repo so opencode has a real working tree.
      const barePath = path.join(GIT_DATA_DIR, repoOwner, `${repoName}.git`);
      log(`[coder] git clone ${barePath} -> ${workDir}`);
      const clone = await sh("git", ["clone", barePath, workDir], { logStream });
      if (clone.exit !== 0) {
        return errorResult(
          `git clone of ${barePath} failed (exit ${clone.exit})`,
          clone.stderr.slice(-800),
        );
      }

      // 1a. If a previous coder run already pushed `agent/issue-{n}` to
      // origin, resume from THAT branch tip instead of the default
      // branch's HEAD. Two reasons:
      //   • The naive flow (always branch from default + push) crashes
      //     with "non-fast-forward" the moment a comment refires the
      //     coder while a PR is still open — the new HEAD isn't a
      //     descendant of the existing agent/issue-{n}.
      //   • Iterating ON the prior attempt matches user intent: a
      //     comment is a follow-up ("good, now also do X"), not a
      //     restart. opencode sees the previously-committed files in
      //     the working tree and builds on them.
      //
      // Detection uses the local `origin/agent/issue-{n}` ref that the
      // initial clone populated — no network round-trip.
      const branch = `agent/issue-${issueNumber}`;
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
        log(
          `[coder] resuming on existing branch ${branch} (prior coder attempt detected — building on it)`,
        );
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
      const uid = os.userInfo().uid;
      const gid = os.userInfo().gid;

      // Hardened docker invocation (P0-S7 + §3.5):
      //   --env OPENROUTER_API_KEY  (no "=value" — Docker reads it from
      //                              the bridge's process env so the key
      //                              never appears in `ps auxe`)
      //   --read-only + --tmpfs /tmp — root fs is read-only inside the
      //                                container; opencode writes only to
      //                                the work bind and /tmp.
      //   --security-opt no-new-privileges — drops the ability to gain
      //                                privileges via setuid binaries.
      //   --cap-drop ALL — strips every Linux capability.
      //   --pids-limit + --ulimit nofile — bound fork bombs / fd
      //                                    exhaustion.
      //   --network — driven by MIND_CODER_NETWORK. Default "bridge"
      //               (legacy behavior) so the existing demo path keeps
      //               working; set MIND_CODER_NETWORK=none to revoke
      //               internet egress entirely (recommended for prod;
      //               the §3.4 Verdaccio-mirror follow-up depends on it).
      const network = process.env.MIND_CODER_NETWORK ?? "bridge";

      // Forward one --env flag per env var the provider expects. The
      // value is NOT included in the CLI args — Docker reads it from the
      // bridge's process env at exec time, so the key never appears in
      // `ps auxe`. We also forward MIND_AI_PROVIDER so the entrypoint
      // knows which provider block to leave enabled in auth.json.
      const dockerArgs = [
        "run",
        "--rm",
        "-v",
        `${workDir}:/work`,
        "--env",
        "MIND_AI_PROVIDER",
      ];
      for (const envName of providerSpec.containerEnvNames) {
        dockerArgs.push("--env", envName);
      }
      dockerArgs.push(
        "--memory=1g",
        "--cpus=1",
        "--pids-limit=256",
        "--ulimit",
        "nofile=1024:1024",
        "--read-only",
        "--tmpfs",
        // chromium (driven by the playwright-mcp tool) writes a few
        // hundred MB of SQLite cache + crash dumps into /tmp on first
        // navigation. 128m got us "database or disk is full" on the
        // first page load; 512m is enough headroom for the prototype.
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
        "run",
        "--dir",
        "/work",
        "-m",
        fullModelArg,
        // Note: we tried `--print-logs --log-level INFO/DEBUG` to surface
        // tool *results* in the per-run log (the default format only
        // echoes tool *requests*, so silent tool failures — like the
        // playwright-mcp file:// block we hit — are indistinguishable
        // from "still working"). Neither level dumps result payloads;
        // they just add 500+ lines of session/bus/permission chatter per
        // run. Real fix is `--format json` + a custom parser in the
        // driver that re-renders calls + responses; left for later.
        "--dangerously-skip-permissions",
        task,
      );

      // Build the env block: the provider's key under every alias it
      // expects (covers SDK version drift), plus MIND_AI_PROVIDER so the
      // container entrypoint knows which auth.json block to emit. We
      // intentionally do NOT pass the bridge's own OPENROUTER_API_KEY
      // when the user picked a different provider — that would leak the
      // bridge default into a container the user thought was on Gemini.
      const containerEnv: NodeJS.ProcessEnv = { ...process.env };
      // Clear every known provider env so we never mix.
      for (const p of PROVIDERS) {
        for (const n of p.containerEnvNames) delete containerEnv[n];
      }
      for (const envName of providerSpec.containerEnvNames) {
        containerEnv[envName] = config.apiKey;
      }
      containerEnv.MIND_AI_PROVIDER = config.provider;

      log(`[coder] docker run (timeout=${timeoutS}s, network=${network})`);
      const t0 = Date.now();
      const oc = await sh("docker", dockerArgs, {
        timeoutMs: timeoutS * 1000,
        logStream,
        env: containerEnv,
      });
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      log(`[coder] docker exit=${oc.exit} (${elapsed}s)`);
      const ocTail = (oc.stdout + (oc.stderr ? `\n[stderr]\n${oc.stderr}` : "")).slice(-2000);
      summaryLines.push(`opencode exit=${oc.exit} (model=${orModel}, ${elapsed}s)`);

      // 3. Inspect what opencode produced. Three shapes:
      //   - no changes at all → error (model went silent)
      //   - only .mind/agent-comment.md → comment-only path
      //   - code changes (with or without the comment file) → PR path
      //     (the comment file, if present, becomes a PR-accompanying note)
      // -uall expands untracked directories so we see `.mind/agent-comment.md`
      // instead of just `.mind/` (the default `--untracked-files=normal`
      // collapses untracked dirs, which fooled the file-mode detection below).
      const status = await sh("git", ["-C", workDir, "status", "--porcelain", "-uall"]);
      // trim only trailing whitespace — leading whitespace is significant
      // in porcelain output: unstaged-modified files start with " M …" and
      // parsePorcelain's positional slice(3) relies on the XY+space prefix.
      const dirty = status.stdout.trimEnd();
      if (!dirty) {
        log(`[coder] no changes detected; aborting`);
        return {
          status: "error",
          summary: [
            `opencode produced no file changes for #${issueNumber}.`,
            "",
            "--- opencode output (last 2000 chars) ---",
            ocTail,
          ].join("\n"),
          error: oc.exit === 0 ? "no changes" : `opencode exit ${oc.exit}`,
          data: { model: orModel, dockerExit: oc.exit },
        };
      }

      const changed = parsePorcelain(dirty);
      const commentBody = await readAgentCommentFile(workDir);
      const screenshotFiles = await readScreenshotFiles(workDir);
      // Anything under .mind/ or .playwright-mcp/ is agent scratch and
      // never counts as a real code change.
      const codeChanges = changed.filter(
        (f) => !AGENT_SCRATCH_DIRS.some((d) => f === d || f.startsWith(`${d}/`)),
      );
      const wantsComment = commentBody !== null;
      const wantsScreenshots = screenshotFiles.length > 0;

      log(
        `[coder] changed files (${changed.length}): ${changed.join(", ")}` +
          (wantsComment ? " [+agent-comment.md]" : "") +
          (wantsScreenshots
            ? ` [+${screenshotFiles.length} screenshot(s)]`
            : ""),
      );

      // Mirror screenshots to host storage FIRST so a pod upload failure
      // (expired refresh token, pod offline, ACL bug, …) doesn't lose
      // the artifact — workDir is wiped in `finally` so this is the only
      // chance to keep them. Pod upload below is best-effort.
      if (wantsScreenshots && ctx.runId !== null) {
        await mirrorScreenshotsToHost({
          workDir,
          files: screenshotFiles,
          runId: ctx.runId,
          log,
        });
      }

      // Screenshots are scratch — upload them to the pod and link, then
      // strip from the work tree so they don't end up in the commit.
      // Upload happens before the mode branches because both paths embed
      // the resulting markdown.
      const uploadedScreenshots = wantsScreenshots
        ? await uploadScreenshots({
            workDir,
            files: screenshotFiles,
            repo,
            issueNumber,
            runId: ctx.runId,
            log,
          })
        : [];
      const screenshotsSection = renderScreenshotsSection(uploadedScreenshots);

      // ---- Comment-only path ----------------------------------------------
      if (wantsComment && codeChanges.length === 0) {
        const fullBody = screenshotsSection
          ? `${commentBody!.trim()}\n\n${screenshotsSection}`
          : commentBody!;
        const posted = await postAgentComment({
          repo,
          issue,
          body: fullBody,
          agentRunId: ctx.runId,
        });
        log(`[coder] posted clarifying comment #${posted.id}`);
        return {
          status: "ok",
          summary: [
            `Posted a clarifying comment on #${issueNumber} (no code changes).`,
            uploadedScreenshots.length > 0
              ? `Attached ${uploadedScreenshots.length} screenshot(s).`
              : "",
            "",
            "--- comment ---",
            truncate(fullBody, 800),
          ]
            .filter(Boolean)
            .join("\n"),
          data: {
            mode: "comment",
            commentId: posted.id,
            screenshots: uploadedScreenshots.map((s) => s.url),
            model: orModel,
            dockerExit: oc.exit,
          },
        };
      }

      // Refuse a run that only produced screenshots — that means the
      // model verified something but didn't say what or change anything.
      if (codeChanges.length === 0 && !wantsComment) {
        log(`[coder] only screenshots produced; aborting`);
        return {
          status: "error",
          summary: `opencode took ${uploadedScreenshots.length} screenshot(s) for #${issueNumber} but produced no code change or comment.`,
          error: "screenshots only",
          data: {
            screenshots: uploadedScreenshots.map((s) => s.url),
            model: orModel,
            dockerExit: oc.exit,
          },
        };
      }

      // ---- PR path (with optional accompanying comment) -------------------
      summaryLines.push(`changed files (${codeChanges.length}): ${codeChanges.join(", ")}`);

      // Drop agent-scratch before committing, but PRESERVE .mind/workflow.yml
      // (and any other repo config under .mind/): it's the build recipe the
      // publisher runs, not scratch — wiping it leaves build-based repos
      // unpublishable. We remove only the known scratch artifacts inside
      // .mind/ (screenshots, agent-comment) plus the whole .playwright-mcp/,
      // which gets re-created every browser call with timestamped traces.
      await fs
        .rm(path.join(workDir, ".playwright-mcp"), { recursive: true, force: true })
        .catch(() => {});
      await fs
        .rm(path.join(workDir, AGENT_SCREENSHOTS_REL), { recursive: true, force: true })
        .catch(() => {});
      await fs
        .rm(path.join(workDir, AGENT_COMMENT_REL), { force: true })
        .catch(() => {});

      // `branch` and `branchExists` were declared up-front (before the
      // opencode run) so we could resume on top of a prior attempt. The
      // commit step here is the SAME regardless of how we got here; the
      // only conditional is the initial `checkout -b` — we already moved
      // onto the branch when resuming.
      const steps: Array<[string, string[]]> = [
        ["config", ["-C", workDir, "config", "user.email", AGENT_WEBID]],
        ["config", ["-C", workDir, "config", "user.name", "mind-codespaces coder"]],
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
              ? `[coder] iterate on #${issueNumber}: ${issue.title}\n\nFollow-up from opencode via model ${orModel}.`
              : `[coder] solve #${issueNumber}: ${issue.title}\n\nGenerated by opencode via model ${orModel}.`,
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
      log(`[coder] pushed branch ${branch} to ${repoOwner}/${repoName}`);

      const sourceSha = (await sh("git", ["-C", workDir, "rev-parse", "HEAD"]))
        .stdout.trim();
      const prBody = [
        `Generated by the coder via opencode (model \`${orModel}\`).`,
        "",
        `Changed files (${codeChanges.length}):`,
        ...codeChanges.map((f) => `- \`${f}\``),
        screenshotsSection ? `\n${screenshotsSection}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const pull = upsertPullRequest({
        repoId: repo.id,
        title: `Solve #${issueNumber}: ${issue.title}`,
        body: prBody,
        sourceBranch: branch,
        targetBranch: repo.defaultBranch,
        sourceSha,
        issueId: issue.id,
      });
      log(`[coder] opened pull request #${pull.number}`);

      if (wantsComment) {
        const noteBody = [
          commentBody!.trim(),
          "",
          `_Opened pull request **#${pull.number}** (\`${branch}\` → \`${repo.defaultBranch}\`) with this work._`,
          screenshotsSection ? `\n${screenshotsSection}` : "",
        ]
          .filter(Boolean)
          .join("\n");
        const posted = await postAgentComment({
          repo,
          issue,
          body: noteBody,
          agentRunId: ctx.runId,
        });
        log(`[coder] posted PR-accompanying comment #${posted.id}`);
      }

      return {
        status: "ok",
        summary: [
          `Opened pull #${pull.number} (${branch} → ${repo.defaultBranch}).`,
          `Changed files (${codeChanges.length}):`,
          ...codeChanges.map((f) => `  - ${f}`),
          uploadedScreenshots.length > 0
            ? `Attached ${uploadedScreenshots.length} screenshot(s).`
            : "",
          "",
          "--- opencode output (last 800 chars) ---",
          ocTail.slice(-800),
        ]
          .filter(Boolean)
          .join("\n"),
        data: {
          mode: "pr",
          branch,
          files: codeChanges,
          screenshots: uploadedScreenshots.map((s) => s.url),
          model: orModel,
          dockerExit: oc.exit,
          pullNumber: pull.number,
        },
      };
    } catch (err) {
      log(`[coder] crash: ${err instanceof Error ? err.message : String(err)}`);
      return {
        status: "error",
        summary: [
          `coder driver crashed: ${err instanceof Error ? err.message : String(err)}`,
          summaryLines.length > 0 ? `Progress before crash: ${summaryLines.join("; ")}` : "",
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

function renderTaskPrompt(input: {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  comments: IssueComment[];
  /** Name of the agent branch we're resuming on, or null for a fresh attempt. */
  resumingFrom: string | null;
}): string {
  const conversation =
    input.comments.length > 0
      ? [
          "",
          `--- Conversation so far (${input.comments.length} comment(s)) ---`,
          ...input.comments.map((c, i) => {
            const who =
              c.agentRunId !== null ? "coder (you, earlier)" : c.authorWebId;
            return [
              `[${i + 1}] ${who}:`,
              c.body.trim(),
              "",
            ].join("\n");
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
        `follow-up: build on what's there, fix what the user pushed back on,`,
        `and only edit what the next iteration requires. If everything the`,
        `user asked for is already present, write \`.mind/agent-comment.md\``,
        `explaining that and exit without changing files.`,
        "",
      ].join("\n")
    : "";

  return [
    `You are the Coder for the ${input.owner}/${input.repo} repository.`,
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
    "Mode B — ASK: if the issue is ambiguous, you need a decision from",
    "the user, or you want to propose a plan before writing code, write",
    "your plan + the specific questions you need answered to the file",
    "`.mind/agent-comment.md` (Markdown) and exit WITHOUT changing any",
    "other files. The file will be posted as a comment on the issue and",
    "the next user reply will re-trigger you with the full conversation.",
    "",
    "You may do both — write `.mind/agent-comment.md` AND edit code — to",
    "implement now while also leaving a note explaining your reasoning.",
    "",
    "PRESERVE THE PROJECT STRUCTURE.",
    "",
    "If this is a build-based app (it has a `package.json` with a build",
    "script and/or a `.mind/workflow.yml` — e.g. Vite / React / Tailwind),",
    "edit only the source files (usually under `src/`). Do NOT convert it",
    "into a single hand-written static HTML file, and do NOT delete, move,",
    "or rewrite `vite.config.*`, `package.json`, the `<script>` tag in",
    "`index.html`, `src/main.*`, or `.mind/workflow.yml`. Do NOT commit",
    "`dist/` or `node_modules/`. The platform runs the build and publishes",
    "the output for you — breaking the build setup means nothing ships.",
    "",
    "VERIFY WITH SCREENSHOTS (OPTIONAL).",
    "",
    "You have browser tools (Playwright MCP) available. Screenshots are a",
    "nice-to-have, not required — your committed code is what ships.",
    "  • Static site (a plain `index.html` that runs with no build): it's",
    "    cheap to verify — open `file:///work/index.html` directly and",
    "    screenshot. Do NOT spin up an HTTP server.",
    "  • Build-based app (Vite/React/etc.): a screenshot needs a full",
    "    `npm install && npm run build` (slow). SKIP it unless you really",
    "    need to check something visually — prefer shipping fast. If you do",
    "    build, open the built entry `file:///work/dist/index.html` (relative",
    "    base renders from file://), never a dev server, and leave `dist/`",
    "    UNCOMMITTED.",
    "If you do take screenshots:",
    "  - Take 1–3 that show the result of your change. Use",
    "    `browser_take_screenshot` with",
    "    `filename: \"/work/.mind/screenshots/<descriptive-name>.png\"`.",
    "  - Stop after 3 screenshots — do not keep iterating in the browser.",
    "",
    "Screenshots in `.mind/screenshots/` are uploaded to the pod and",
    "embedded in the PR body automatically. Do not commit them yourself;",
    "scratch directories `.mind/` and `.playwright-mcp/` are stripped",
    "from the work tree before commit.",
    "",
    "When done, simply end your reply. Do NOT run any shell command —",
    "no `exit`, no `pkill`. Your turn ending IS the signal that you're",
    "done; opencode terminates automatically. Running `exit` does nothing",
    "and burns wall time the bridge has to wait through.",
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

/** Copy screenshots from the container workdir into a per-run dir under
 *  AGENT_LOGS_DIR so they survive the post-run workDir cleanup even if
 *  the pod upload fails. Best-effort — never throws, only logs. */
async function mirrorScreenshotsToHost(input: {
  workDir: string;
  files: string[];
  runId: number;
  log: (line: string) => void;
}): Promise<void> {
  const dest = path.join(AGENT_LOGS_DIR, `run-${input.runId}`, "screenshots");
  try {
    await fs.mkdir(dest, { recursive: true });
    for (const name of input.files) {
      const src = path.join(input.workDir, AGENT_SCREENSHOTS_REL, name);
      const dst = path.join(dest, name);
      try {
        await fs.copyFile(src, dst);
      } catch (err) {
        input.log(
          `[coder] host-mirror failed for ${name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    input.log(`[coder] mirrored ${input.files.length} screenshot(s) to ${dest}`);
  } catch (err) {
    input.log(
      `[coder] host-mirror dir create failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Filenames (basenames) of any screenshots opencode wrote under
 *  `.mind/screenshots/`. Empty list if the directory doesn't exist. */
async function readScreenshotFiles(workDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(workDir, AGENT_SCREENSHOTS_REL));
    return entries.filter((n) => IMAGE_EXT_RE.test(n)).sort();
  } catch {
    return [];
  }
}

type UploadedShot = { name: string; url: string };

/**
 * PUT each screenshot to the owner's pod at a stable, per-run URL and
 * publish a public-read ACL so the markdown image embeds load for
 * anyone viewing the PR. Returns the resulting (name, url) pairs.
 *
 * Path shape: `{podRoot}/codespaces/{repo}/issues/{n}/runs/{runId}/screenshots/{name}`.
 * Tied to runId so re-runs don't overwrite earlier history; when runId
 * is null (event referenced an unknown repo and no agent_runs row was
 * created) we fall back to a timestamp slug.
 *
 * All errors are best-effort: a failed upload logs and continues. The
 * caller decides what to do with a partial list.
 */
async function uploadScreenshots(input: {
  workDir: string;
  files: string[];
  repo: Repo;
  issueNumber: number;
  runId: number | null;
  log: (line: string) => void;
}): Promise<UploadedShot[]> {
  if (input.files.length === 0) return [];

  let owner;
  try {
    owner = await getOwnerFetch(input.repo.ownerWebId);
  } catch (err) {
    input.log(
      `[coder] screenshot upload skipped: no fetch for ${input.repo.ownerWebId} (${err instanceof Error ? err.message : String(err)})`,
    );
    return [];
  }

  const root = input.repo.ownerPodRoot.endsWith("/")
    ? input.repo.ownerPodRoot
    : `${input.repo.ownerPodRoot}/`;
  const runSeg =
    input.runId !== null ? `run-${input.runId}` : `run-${Date.now()}`;
  const containers = [
    `${root}codespaces/`,
    `${root}codespaces/${input.repo.name}/`,
    `${root}codespaces/${input.repo.name}/issues/`,
    `${root}codespaces/${input.repo.name}/issues/${input.issueNumber}/`,
    `${root}codespaces/${input.repo.name}/issues/${input.issueNumber}/runs/`,
    `${root}codespaces/${input.repo.name}/issues/${input.issueNumber}/runs/${runSeg}/`,
    `${root}codespaces/${input.repo.name}/issues/${input.issueNumber}/runs/${runSeg}/screenshots/`,
  ];
  const screenshotsContainer = containers[containers.length - 1];

  try {
    for (const url of containers) await ensureContainer(owner.fetch, url);
    // Default ACL propagates from the screenshots container to its
    // children, so a single PUT on `.acl` covers every image we upload.
    await setPublicReadAcl(owner.fetch, screenshotsContainer, input.repo.ownerWebId);
  } catch (err) {
    input.log(
      `[coder] screenshot container setup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }

  const uploaded: UploadedShot[] = [];
  for (const name of input.files) {
    const filePath = path.join(input.workDir, AGENT_SCREENSHOTS_REL, name);
    try {
      const bytes = await fs.readFile(filePath);
      const url = `${screenshotsContainer}${encodeURIComponent(name)}`;
      const res = await owner.fetch(url, {
        method: "PUT",
        headers: { "Content-Type": guessImageMime(name) },
        body: bytes,
      });
      if (!res.ok) {
        input.log(
          `[coder] screenshot PUT ${name} failed: ${res.status} ${res.statusText}`,
        );
        continue;
      }
      uploaded.push({ name, url });
    } catch (err) {
      input.log(
        `[coder] screenshot upload error for ${name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  input.log(
    `[coder] uploaded ${uploaded.length}/${input.files.length} screenshot(s) to ${screenshotsContainer}`,
  );
  return uploaded;
}

/** Markdown section that embeds uploaded screenshots inline. Returns
 *  empty string when there are none so callers can `.filter(Boolean)`. */
function renderScreenshotsSection(uploaded: UploadedShot[]): string {
  if (uploaded.length === 0) return "";
  return [
    "### Screenshots",
    "",
    ...uploaded.map((s) => `![${s.name}](${s.url})`),
  ].join("\n");
}

function guessImageMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
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
      `[coder] writeCommentToPod for ${input.repo.owner}/${input.repo.name}#${input.issue.number} failed:`,
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

/**
 * Parse `git status --porcelain` output into bare filenames.
 *
 * Documented format: each line is exactly `XY filename`, where XY are
 * two single-char status codes (one for the index, one for the worktree;
 * either may be a space), followed by exactly one space, then the path.
 * Renames are `RX  old -> new` or `XR  old -> new` with a tab/space
 * separator depending on git version.
 *
 * In practice we've seen the engineer pipeline produce summaries like
 * "M style.css" where the leading status char survived — that's the
 * regex falling through to "return whole line" because the line shape
 * was off by a char. We now do this positionally:
 *
 *   1. Take everything from index 3 onward (the filename per spec).
 *   2. If the result is empty or weirdly short, fall back to a regex
 *      that strips any reasonable status-char-and-whitespace prefix.
 *   3. For renames, take just the destination after " -> ".
 *
 * Quoted paths (git sets core.quotePath=true by default for paths with
 * special chars, surrounding them in double quotes) are unquoted last.
 */
export function parsePorcelain(out: string): string[] {
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      // Rename: "XY  old -> new" — take the destination.
      const arrow = l.indexOf(" -> ");
      if (arrow >= 0 && /^.{2}\s/.test(l)) {
        return unquotePath(l.slice(arrow + 4));
      }
      // Positional slice — every porcelain line per spec is XY + space + path.
      const positional = l.length > 3 ? l.slice(3) : "";
      if (positional.length > 0 && !/^\s/.test(positional)) {
        return unquotePath(positional);
      }
      // Defensive fallback for malformed lines: strip any combination of
      // status chars, question marks, exclamation marks, and whitespace
      // from the start. Used to last-resort recover something readable.
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
    // detached: true so the timeout path can kill the WHOLE process
    // group (docker run forks helpers; SIGKILL-ing only the parent leaves
    // the actual container running until it times out on its own).
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
      resolve({
        exit: killed ? 124 : code ?? 0,
        stdout,
        stderr,
      });
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
