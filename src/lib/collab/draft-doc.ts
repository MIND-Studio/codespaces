"use client";

import { IndexeddbPersistence } from "y-indexeddb";
import type { Awareness } from "y-protocols/awareness";
import { WebsocketProvider } from "y-websocket";
import * as Y from "yjs";
import { collabRelayUrl } from "./config";

/**
 * The Yjs layer for one collaborative issue/epic draft.
 *
 * One draft === one `Y.Doc`. Inside it:
 *   • `body`  (Y.XmlFragment, named "body") — the TipTap document. The editor's
 *     Collaboration extension owns reads/writes here; we never touch it directly.
 *   • `meta`  (Y.Map) — the small, low-conflict fields around the body:
 *       title, kind ("issue" | "epic"), type (category id), epicSlug, priority.
 *     These are last-write-wins, which is fine for a single-line title and a few
 *     single-select toggles.
 *   • awareness — ephemeral presence (peer name + color), never persisted.
 *
 * Two providers attach: IndexeddbPersistence (per-browser offline cache) and
 * WebsocketProvider (the live, ephemeral relay; room = the namespaced draft id).
 * The durable store is git/`.mind` — the draft is committed there on "Create".
 */

export type DraftKind = "issue" | "epic";

export type DraftMeta = {
  title: string;
  kind: DraftKind;
  /** Category id (the tracker.config.md label, e.g. "feature"). */
  type: string;
  /** Epic slug, or "general" for the un-epic'd lane. */
  epicSlug: string;
  /** urgent | high | normal | low. */
  priority: string;
};

export const DEFAULT_META: DraftMeta = {
  title: "",
  kind: "issue",
  type: "feature",
  epicSlug: "general",
  priority: "normal",
};

export type DraftDoc = {
  doc: Y.Doc;
  /**
   * The live relay provider, or `null` when the repo has live multiplayer
   * turned off (local-only drafting). Consumers must guard on it: no relay
   * means no presence/awareness and no peer sync.
   */
  provider: WebsocketProvider | null;
  /** Presence/awareness, or `null` in local-only mode (no relay). */
  awareness: Awareness | null;
  /** The Y.Map holding {@link DraftMeta}. */
  meta: Y.Map<unknown>;
  /** Resolves once the local IndexedDB copy has loaded into the doc. */
  whenSynced: Promise<unknown>;
  destroy: () => void;
};

/**
 * Create the Yjs handle for a draft.
 *
 * With `collab` on (default), connect to the relay eagerly — live co-authoring
 * with presence; solo authoring still works offline via the IndexedDB cache if
 * the relay happens to be down. With `collab` off (the repo owner disabled
 * "live multiplayer"), no relay is opened at all: the draft is a normal local
 * document, persisted only to this browser's IndexedDB until it's committed to
 * `.mind`.
 */
export function createDraftDoc(roomName: string, opts: { collab?: boolean } = {}): DraftDoc {
  const collab = opts.collab ?? true;
  const doc = new Y.Doc();

  // y-indexeddb keys its store by name; namespace it so codespaces drafts never
  // collide with another app sharing the origin during local dev.
  const idb = new IndexeddbPersistence(`mind-codespaces:${roomName}`, doc);

  const provider = collab
    ? new WebsocketProvider(collabRelayUrl, roomName, doc, { connect: true })
    : null;

  const meta = doc.getMap("meta");

  function destroy() {
    if (provider) {
      try {
        provider.awareness.setLocalState(null);
      } catch {
        /* ignore */
      }
      provider.destroy();
    }
    void idb.destroy();
    doc.destroy();
  }

  return {
    doc,
    provider,
    awareness: provider?.awareness ?? null,
    meta,
    whenSynced: idb.whenSynced,
    destroy,
  };
}

/** Read the typed {@link DraftMeta} out of the Y.Map, filling defaults. */
export function readDraftMeta(meta: Y.Map<unknown>): DraftMeta {
  const get = <K extends keyof DraftMeta>(k: K): DraftMeta[K] => {
    const v = meta.get(k);
    return typeof v === "string" ? (v as DraftMeta[K]) : DEFAULT_META[k];
  };
  return {
    title: get("title"),
    kind: get("kind") === "epic" ? "epic" : "issue",
    type: get("type"),
    epicSlug: get("epicSlug"),
    priority: get("priority"),
  };
}
