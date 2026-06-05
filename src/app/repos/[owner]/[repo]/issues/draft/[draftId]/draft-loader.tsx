"use client";

import dynamic from "next/dynamic";
import type { CollaborativeDraftProps } from "./collaborative-draft";

// The editor creates a Yjs doc with IndexedDB + WebSocket providers and TipTap
// (ProseMirror touches `window`), so it must never server-render. One ssr:false
// boundary keeps the whole CRDT/editor subtree out of the server render — the
// same pattern the whiteboard uses for its Excalidraw canvas. (next/dynamic with
// ssr:false can't live in a Server Component, hence this thin client loader.)
const CollaborativeDraft = dynamic(
  () => import("./collaborative-draft").then((m) => m.CollaborativeDraft),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-[color:var(--ink-faint)]">Loading the composer…</p>
    ),
  },
);

export function DraftLoader(props: CollaborativeDraftProps) {
  return <CollaborativeDraft {...props} />;
}
