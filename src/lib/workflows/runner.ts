import "server-only";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import {
  getRepoById,
  getPagesConfig,
  markPagesPublished,
} from "@/lib/registry/repos";
import { repoPath, readBranchHead } from "@/lib/git/backend";
import { checkoutBranchToTempDir } from "@/lib/git/checkout";
import {
  createRun,
  finishRun,
  getRunById,
  markRunRunning,
  type WorkflowRun,
} from "@/lib/registry/runs";
import { parseWorkflow, WorkflowParseError } from "@/lib/workflows/parse";
import { publishDirectory } from "@/lib/pages/publisher";
import { resolveRunnerMode, runShellBatch } from "@/lib/workflows/docker";
import { withPublishLock } from "@/lib/pages/publish-lock";
import { Metrics } from "@/lib/metrics";

const WORKFLOW_PATH = ".mind/workflow.yml";

/**
 * Run the repo's workflow (if any) for the just-pushed ref. Returns
 * the persisted `WorkflowRun` row in its final state. Caller may use it
 * to decide whether to also kick off the existing Pages publisher (when
 * no workflow exists).
 *
 * Execution model:
 *   1. Clone the ref into a temp dir (single-branch, depth 1).
 *   2. If `.mind/workflow.yml` is missing, no run is recorded — return null.
 *   3. Parse the workflow; on schema errors, persist status='error'.
 *   4. Decide runner mode (docker if available, else native — overridable
 *      via MIND_RUNNER env var) and run ALL `run:` commands as a single
 *      shell batch with `set -e`. One container per workflow keeps
 *      `node_modules` and tool caches alive across steps.
 *   5. On success, if `publish:` is set AND Pages is enabled, upload the
 *      named dir to the configured pod container via the existing publisher.
 *   6. Persist final status (success | failed | error) + log tail.
 *
 * Sandbox properties depend on mode. In `docker` mode the build can't
 * trash the host filesystem (bind-mount only) but can still reach the
 * network (npm registry, etc.). In `native` mode there is no sandbox
 * beyond the wallclock timeout. See docs/WORKFLOWS-PLAN.md for the
 * threat-model details.
 */
export async function runWorkflow(input: {
  repoId: number;
  ref: string;
  branch: string; // already stripped of `refs/heads/` prefix
}): Promise<WorkflowRun | null> {
  const repo = getRepoById(input.repoId);
  if (!repo) throw new Error(`repo id=${input.repoId} not found`);

  const bare = repoPath(repo.owner, repo.name);
  const { tempDir, cleanup } = await checkoutBranchToTempDir(
    bare,
    input.branch,
  );

  // No-workflow path: silently return; caller falls back to legacy Pages publish.
  const workflowPath = join(tempDir, WORKFLOW_PATH);
  if (!(await exists(workflowPath))) {
    await cleanup();
    return null;
  }

  // Workflow exists — record a run row from here on so any failure surfaces in the UI.
  const run = createRun(repo.id, input.ref);
  const tag = `[workflow ${repo.owner}/${repo.name}#${run.id}]`;

  try {
    markRunRunning(run.id);
    console.log(`${tag} starting`);

    let workflow;
    try {
      const source = await readFile(workflowPath, "utf-8");
      workflow = parseWorkflow(source);
    } catch (e) {
      const message =
        e instanceof WorkflowParseError
          ? e.message
          : `failed to read workflow: ${(e as Error).message}`;
      console.warn(`${tag} parse error: ${message}`);
      finishRun(run.id, {
        status: "error",
        exitCode: null,
        log: "",
        errorMessage: message,
      });
      Metrics.workflowRun("error");
      return getRunById(run.id);
    }

    const mode = await resolveRunnerMode();
    let log = `[runner: ${mode}]\n`;
    console.log(`${tag} runner=${mode}, ${workflow.run.length} command(s)`);

    const batch = await runShellBatch({
      commands: workflow.run,
      cwd: tempDir,
      timeoutMs: workflow.timeoutMs,
      mode,
    });
    log += batch.log;

    if (batch.exitCode !== 0) {
      log += `\n[batch exited ${batch.exitCode}]\n`;
      finishRun(run.id, { status: "failed", exitCode: batch.exitCode, log });
      Metrics.workflowRun("failed");
      console.warn(`${tag} failed (exit ${batch.exitCode})`);
      return getRunById(run.id);
    }

    // Run succeeded. Maybe publish.
    if (workflow.publish) {
      const pages = getPagesConfig(repo.id);
      if (pages?.enabled && pages.targetContainer) {
        const publishDir = resolvePublishDir(tempDir, workflow.publish);
        log += `\n[publishing ${workflow.publish}/ → ${pages.targetContainer}]\n`;
        try {
          // Serialize publishes per-repo (P0-R1) so concurrent pushes
          // don't race the publisher's prune step against each other.
          const lockResult = await withPublishLock(repo.id, () =>
            publishDirectory({
              repo,
              pages,
              sourceDir: publishDir,
            }),
          );
          if (lockResult === "coalesced") {
            log += `[publish coalesced into an in-flight run]\n`;
          } else {
            log += `[published ${lockResult.uploaded} file(s)]\n`;
            const headSha = await readBranchHead(
              repo.owner,
              repo.name,
              input.branch,
            );
            markPagesPublished(repo.id, { sha: headSha });
          }
        } catch (e) {
          const msg = (e as Error).message ?? String(e);
          log += `\n[publish failed: ${msg}]\n`;
          // pages_configs.last_publish_status is already written by the
          // publisher's catch — finishRun records the workflow row.
          finishRun(run.id, {
            status: "failed",
            exitCode: 0,
            log,
            errorMessage: `publish failed: ${msg}`,
          });
          Metrics.workflowRun("failed");
          console.warn(`${tag} publish failed: ${msg}`);
          return getRunById(run.id);
        }
      } else {
        log += `\n[publish: dir set but Pages is not enabled; skipping upload]\n`;
      }
    }

    finishRun(run.id, { status: "success", exitCode: 0, log });
    Metrics.workflowRun("success");
    console.log(`${tag} success`);
    return getRunById(run.id);
  } finally {
    await cleanup();
  }
}

function resolvePublishDir(tempDir: string, publish: string): string {
  const resolved = resolve(tempDir, publish);
  const root = tempDir.endsWith(sep) ? tempDir : tempDir + sep;
  if (!resolved.startsWith(root)) {
    throw new Error(`publish dir escapes the checkout: ${publish}`);
  }
  return resolved;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

