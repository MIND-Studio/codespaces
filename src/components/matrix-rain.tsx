"use client";

import { useEffect, useRef } from "react";

const STREAM = [
  "git push", "git pull", "git fetch", "git clone", "git commit", "git rebase",
  "main", "HEAD", "origin", "refs/heads", "refs/tags", "branch",
  "pod", "WebID", "Solid", "OIDC", "DPoP", "Bearer",
  "ttl", "turtle", "rdf", "ldp", "vcard", "foaf", "dcterms", "xsd",
  ".ttl", ".html", ".css", ".js", "index.html", "card#me",
  "/alice/", "/huhn511/", "/public/", "/sites/", "/codespaces/", "/profile/",
  "alice/bakery", "alice/notes", "alice/marked-blog", "alice/tailwind-site",
  "alice/about", "alice/built-site", "huhn511/hello", "mind/compass",
  ".mind/workflow.yml", "node:22-alpine", "docker run --rm",
  "200 OK", "201 Created", "204 No Content", "401", "403", "404", "409",
  "GET", "POST", "PUT", "DELETE", "PATCH",
  "smart-http", "post-receive", "bare repo", "push-token",
  "Mind Codespaces", "Solid Git Bridge",
  "sha256", "0xdeadbeef", "0xcafe", "0xfeed",
  "codespaces", "registry", "publisher", "engineer", "triager", "scribe",
];

const HEAD_COLOR = "rgba(220, 255, 225, ";
const BRIGHT_COLOR = "rgba(110, 255, 142, ";
const DIM_COLOR = "rgba(0, 200, 55, ";

type Drop = {
  y: number;
  speed: number;
  wordQueue: string;
  trail: string[];
};

function pickWord(): string {
  return STREAM[(Math.random() * STREAM.length) | 0] + "  ";
}

type Props = {
  /** Width in CSS pixels. Default 180. */
  width?: number;
  /** Height in CSS pixels. Default 110. */
  height?: number;
  /** Font + cell size in CSS pixels. Default 12. */
  cellSize?: number;
  /** Max trail length. Default 12. */
  trailLength?: number;
  /** Optional className for the outer frame. */
  className?: string;
};

/**
 * An inline matrix-rain canvas. No fixed positioning — sits where it's placed.
 * Always animates (intended as a loading/active indicator). Pauses when the
 * tab is hidden.
 */
export function MatrixRain({
  width = 180,
  height = 110,
  cellSize = 12,
  trailLength = 12,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const cv: HTMLCanvasElement = canvasRef.current;
    const c2d = cv.getContext("2d");
    if (!c2d) return;
    const c: CanvasRenderingContext2D = c2d;

    const cellW = cellSize;
    const cellH = cellSize + 2;
    const cols = Math.max(1, Math.floor(width / cellW));
    const rows = Math.max(1, Math.floor(height / cellH));

    const drops: Drop[] = Array.from({ length: cols }, () => ({
      y: -Math.random() * rows * 1.5,
      speed: 0.18 + Math.random() * 0.55,
      wordQueue: pickWord(),
      trail: [],
    }));

    let rafId = 0;
    let running = false;
    const dpr = window.devicePixelRatio || 1;

    cv.width = width * dpr;
    cv.height = height * dpr;
    cv.style.width = width + "px";
    cv.style.height = height + "px";
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.font = `${cellSize - 2}px ui-monospace, "JetBrains Mono", "Menlo", monospace`;
    c.textBaseline = "top";
    c.fillStyle = "rgba(0, 0, 0, 1)";
    c.fillRect(0, 0, width, height);

    function tick() {
      if (!running) return;
      c.fillStyle = "rgba(0, 0, 0, 0.14)";
      c.fillRect(0, 0, width, height);

      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        d.y += d.speed;

        if (!d.wordQueue.length) d.wordQueue = pickWord();
        const ch = d.wordQueue[0];
        d.wordQueue = d.wordQueue.slice(1);
        d.trail.push(ch);
        if (d.trail.length > trailLength) d.trail.shift();

        const headRow = d.y | 0;
        const x = i * cellW + 1;
        for (let k = d.trail.length - 1; k >= 0; k--) {
          const dist = d.trail.length - 1 - k;
          const yPx = (headRow - dist) * cellH;
          if (yPx < -cellH || yPx > height) continue;
          const t = 1 - dist / d.trail.length;
          let color: string;
          if (k === d.trail.length - 1) {
            color = HEAD_COLOR + (0.95 * t).toFixed(3) + ")";
          } else if (dist < 2) {
            color = BRIGHT_COLOR + (0.7 * t).toFixed(3) + ")";
          } else {
            color = DIM_COLOR + (0.4 * t).toFixed(3) + ")";
          }
          c.fillStyle = color;
          c.fillText(d.trail[k], x, yPx);
        }

        if (headRow * cellH > height + 40) {
          d.y = -Math.random() * 4;
          d.trail = [];
          d.wordQueue = pickWord();
          d.speed = 0.18 + Math.random() * 0.55;
        }
      }

      rafId = requestAnimationFrame(tick);
    }

    function start() {
      if (running) return;
      running = true;
      rafId = requestAnimationFrame(tick);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(rafId);
    }

    start();

    const onVis = () => {
      if (document.hidden) stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [width, height, cellSize, trailLength]);

  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: "relative",
        display: "inline-block",
        width: width + "px",
        height: height + "px",
        border: "1px solid rgba(0, 255, 65, 0.5)",
        boxShadow:
          "0 0 0 1px rgba(0, 255, 65, 0.12), 0 0 22px rgba(0, 255, 65, 0.22), inset 0 0 14px rgba(0, 255, 65, 0.08)",
        background: "rgba(0, 0, 0, 0.85)",
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
      <span
        style={{
          position: "absolute",
          top: "-1px",
          left: "-1px",
          width: "10px",
          height: "10px",
          border: "1px solid rgba(0, 255, 65, 0.95)",
          borderRight: 0,
          borderBottom: 0,
          boxShadow: "0 0 6px rgba(0, 255, 65, 0.65)",
        }}
      />
      <span
        style={{
          position: "absolute",
          bottom: "-1px",
          right: "-1px",
          width: "10px",
          height: "10px",
          border: "1px solid rgba(0, 255, 65, 0.95)",
          borderLeft: 0,
          borderTop: 0,
          boxShadow: "0 0 6px rgba(0, 255, 65, 0.65)",
        }}
      />
    </div>
  );
}
