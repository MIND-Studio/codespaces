import "server-only";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Readable } from "node:stream";
import { getGitDataDir } from "@/lib/git/backend";

// Module-scope set of every live `git http-backend` child. Drained on
// SIGTERM so an orderly shutdown doesn't strand grandchildren. P0-R3.
const liveChildren = new Set<ChildProcessWithoutNullStreams>();

let shutdownHookInstalled = false;
function installShutdownHook(): void {
  if (shutdownHookInstalled) return;
  shutdownHookInstalled = true;
  const drain = () => {
    for (const child of liveChildren) {
      try {
        // Kill the whole process group (spawned with `detached: true`).
        if (typeof child.pid === "number") process.kill(-child.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
  };
  process.once("SIGTERM", drain);
  process.once("SIGINT", drain);
}

const REQUEST_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes per Smart-HTTP request

/**
 * Run `git http-backend` (the system Git binary's Smart HTTP CGI) for a
 * single Next.js Route Handler request. Streams the request body into
 * the child's stdin and streams the child's stdout back to the client
 * after parsing CGI-style response headers.
 *
 * Process supervision (P0-R3):
 *   - Child is spawned with `detached: true` so it leads its own process
 *     group; we kill the group (negative pid) on cancel/timeout/shutdown
 *     to reap any grandchildren `git http-backend` forks.
 *   - `req.signal.aborted` propagates into the child kill.
 *   - A wall-clock timeout caps each request at 10 min.
 *   - A non-zero exit AFTER headers have been emitted produces an error
 *     on the response stream (vs the previous code path, which produced
 *     a truncated success — a git client would see a partial success).
 */
export async function runGitHttpBackend(req: Request, pathInfo: string): Promise<Response> {
  installShutdownHook();

  const url = new URL(req.url);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_PROJECT_ROOT: getGitDataDir(),
    GIT_HTTP_EXPORT_ALL: "1",
    REQUEST_METHOD: req.method,
    PATH_INFO: pathInfo,
    QUERY_STRING: url.search.startsWith("?") ? url.search.slice(1) : url.search,
    CONTENT_TYPE: req.headers.get("content-type") ?? "",
    CONTENT_LENGTH: req.headers.get("content-length") ?? "",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.receivepack",
    GIT_CONFIG_VALUE_0: "true",
  };

  const child = spawn("git", ["http-backend"], { env, detached: true });
  liveChildren.add(child);

  // Kill the process group; the child + any grandchildren go together.
  let killed = false;
  const killGroup = (signal: NodeJS.Signals = "SIGTERM") => {
    if (killed) return;
    killed = true;
    try {
      if (typeof child.pid === "number") process.kill(-child.pid, signal);
    } catch {
      /* already gone */
    }
    // Escalate to SIGKILL if the process is still alive after 5s.
    setTimeout(() => {
      try {
        if (typeof child.pid === "number") process.kill(-child.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }, 5_000).unref();
  };

  // Wall-clock cap.
  const timeout = setTimeout(() => {
    console.warn(`[git-http] request timeout after ${REQUEST_TIMEOUT_MS}ms; killing`);
    killGroup();
  }, REQUEST_TIMEOUT_MS);
  timeout.unref();

  // AbortSignal: a client disconnect (Next.js sets req.signal.aborted)
  // tears down the child immediately so we don't keep computing for a
  // client that walked away.
  if (req.signal) {
    if (req.signal.aborted) {
      killGroup();
    } else {
      req.signal.addEventListener("abort", () => killGroup());
    }
  }

  // Forward the request body (if any) into the CGI's stdin.
  if (req.body && req.method !== "GET" && req.method !== "HEAD") {
    Readable.fromWeb(req.body as never)
      .pipe(child.stdin)
      .on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code !== "EPIPE") {
          console.error("[git-http] stdin pipe error:", err);
        }
      });
  } else {
    child.stdin.end();
  }

  child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(`[git-http] ${chunk.toString()}`);
  });

  return new Promise<Response>((resolveResponse, rejectResponse) => {
    let buffered = Buffer.alloc(0);
    let headersParsed = false;
    let status = 200;
    const headers = new Headers();
    let bodyController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let pendingClose = false;

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        if (pendingClose) controller.close();
      },
      cancel() {
        killGroup();
      },
    });

    function tryParseHeaders(): boolean {
      let sepIdx = buffered.indexOf("\r\n\r\n");
      let sepLen = 4;
      if (sepIdx < 0) {
        sepIdx = buffered.indexOf("\n\n");
        sepLen = 2;
      }
      if (sepIdx < 0) return false;

      const headerText = buffered.slice(0, sepIdx).toString("utf-8");
      const bodyStart = buffered.slice(sepIdx + sepLen);
      buffered = Buffer.alloc(0);

      for (const line of headerText.split(/\r?\n/)) {
        if (!line) continue;
        const colon = line.indexOf(":");
        if (colon < 0) continue;
        const key = line.slice(0, colon).trim();
        const value = line.slice(colon + 1).trim();
        if (key.toLowerCase() === "status") {
          const parsed = parseInt(value, 10);
          if (!Number.isNaN(parsed)) status = parsed;
        } else {
          headers.append(key, value);
        }
      }
      headersParsed = true;

      const response = new Response(body, { status, headers });
      resolveResponse(response);

      if (bodyStart.length > 0) {
        if (bodyController) bodyController.enqueue(bodyStart);
        else buffered = bodyStart;
      }
      return true;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      if (!headersParsed) {
        buffered = Buffer.concat([buffered, chunk]);
        if (!tryParseHeaders()) return;
      } else {
        if (bodyController) bodyController.enqueue(chunk);
      }
    });

    child.stdout.on("end", () => {
      pendingClose = true;
      if (bodyController) bodyController.close();
      if (!headersParsed) {
        rejectResponse(new Error("git http-backend exited without emitting CGI headers"));
      }
    });

    child.stdout.on("error", (err) => {
      if (bodyController) bodyController.error(err);
      if (!headersParsed) rejectResponse(err);
    });

    child.on("error", (err) => {
      if (!headersParsed) rejectResponse(err);
      else if (bodyController) bodyController.error(err);
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      liveChildren.delete(child);
      if (code !== 0) {
        if (!headersParsed) {
          rejectResponse(new Error(`git http-backend exited with code ${code} before any output`));
        } else if (bodyController) {
          // Headers already emitted, then the CGI died mid-body. The
          // git client would otherwise see a truncated success and trust
          // the bytes — surface the failure as a stream error instead.
          bodyController.error(new Error(`git http-backend exited with code ${code} mid-body`));
        }
      }
    });
  });
}
