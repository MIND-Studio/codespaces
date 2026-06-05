"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import {
  Button,
  Input,
  Textarea,
  Tabs,
  TabsList,
  TabsTrigger,
  ToggleGroup,
  ToggleGroupItem,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@mind-studio/ui";
import { authedFetch } from "@/lib/auth/csrf-client";
import {
  createDraftDoc,
  readDraftMeta,
  type DraftDoc,
  type DraftMeta,
} from "@/lib/collab/draft-doc";
import { colorForClient, draftRoomName } from "@/lib/collab/config";
import { suggestKind } from "@/lib/collab/suggest-kind";

export type CategoryOption = { id: string; label: string };
export type EpicOption = { slug: string; title: string };

export type CollaborativeDraftProps = {
  owner: string;
  repo: string;
  draftId: string;
  isOwner: boolean;
  /** Repo-level "live multiplayer" flag. Off → local-only draft (no relay). */
  collab: boolean;
  user: { webId: string; name: string };
  categories: CategoryOption[];
  epics: EpicOption[];
};

const PRIORITIES = ["urgent", "high", "normal", "low"];

/**
 * Boots the Yjs doc for this draft (client-only) and renders the editor once the
 * doc + relay are wired. Rendered behind an `ssr:false` boundary, so the body
 * only runs in the browser (Yjs touches IndexedDB / WebSocket).
 */
export function CollaborativeDraft(props: CollaborativeDraftProps) {
  const { owner, repo, draftId, collab } = props;
  const roomName = useMemo(
    () => draftRoomName(owner, repo, draftId),
    [owner, repo, draftId],
  );
  const [draft, setDraft] = useState<DraftDoc | null>(null);

  useEffect(() => {
    // No meta seeding: readDraftMeta() fills defaults on read, so writing them
    // here would let a late-joiner's default (e.g. an empty title) clobber an
    // existing value via last-write-wins. Meta stays unset until someone edits.
    const d = createDraftDoc(roomName, { collab });
    setDraft(d);
    return () => {
      d.destroy();
      setDraft(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomName, collab]);

  if (!draft) {
    return (
      <p className="text-sm text-[color:var(--ink-faint)]">
        {collab ? "Connecting to the draft room…" : "Loading the composer…"}
      </p>
    );
  }
  return <DraftEditor draft={draft} {...props} />;
}

function DraftEditor({
  draft,
  owner,
  repo,
  isOwner,
  user,
  categories,
  epics,
}: CollaborativeDraftProps & { draft: DraftDoc }) {
  const router = useRouter();

  const [meta, setMeta] = useState<DraftMeta>(() => readDraftMeta(draft.meta));
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [view, setView] = useState<"rich" | "markdown">("rich");
  const [mdDraft, setMdDraft] = useState("");
  const [peers, setPeers] = useState<Array<{ id: number; name: string; color: string }>>([]);
  const [connected, setConnected] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const kindTouched = useRef(false);

  const color = useMemo(() => colorForClient(draft.doc.clientID), [draft]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ history: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder:
          "Describe it… use the toolbar, or markdown: ## heading, - list, [ ] task, **bold**",
      }),
      Markdown.configure({
        html: false,
        tightLists: true,
        bulletListMarker: "-",
        transformPastedText: true,
      }),
      Collaboration.configure({ document: draft.doc, field: "body" }),
      // Live peer carets only exist with a relay. In local-only mode there is
      // no provider, so the cursor extension is omitted entirely.
      ...(draft.provider
        ? [
            CollaborationCursor.configure({
              provider: draft.provider,
              user: { name: user.name, color },
            }),
          ]
        : []),
    ],
    editorProps: {
      attributes: { class: "focus:outline-none min-h-[16rem]" },
    },
  });

  // Mirror the collaborative meta into React state.
  useEffect(() => {
    const update = () => setMeta(readDraftMeta(draft.meta));
    draft.meta.observe(update);
    update();
    return () => draft.meta.unobserve(update);
  }, [draft]);

  // Track the body markdown (for the issue/epic suggestion + preview).
  useEffect(() => {
    if (!editor) return;
    const sync = () => setBodyMarkdown(editor.storage.markdown.getMarkdown());
    editor.on("update", sync);
    sync();
    return () => {
      editor.off("update", sync);
    };
  }, [editor]);

  // Presence (peer carets are drawn by CollaborationCursor; this powers the avatars).
  useEffect(() => {
    const aw = draft.awareness;
    if (!aw) return; // local-only mode: no relay, no presence.
    const update = () => {
      const list: Array<{ id: number; name: string; color: string }> = [];
      aw.getStates().forEach((state, id) => {
        if (id === aw.clientID) return;
        const u = (state as { user?: { name?: string; color?: string } }).user;
        if (u?.name) list.push({ id, name: u.name, color: u.color ?? "#888" });
      });
      setPeers(list);
    };
    aw.on("change", update);
    update();
    return () => aw.off("change", update);
  }, [draft]);

  // Relay connection status.
  useEffect(() => {
    const p = draft.provider;
    if (!p) return; // local-only mode: never "connected".
    const onStatus = (e: { status: string }) => setConnected(e.status === "connected");
    p.on("status", onStatus);
    setConnected(p.wsconnected);
    return () => p.off("status", onStatus);
  }, [draft]);

  const suggestion = useMemo(() => suggestKind(bodyMarkdown), [bodyMarkdown]);

  // Pre-set the Kind toggle from the suggestion until the user picks one.
  useEffect(() => {
    if (kindTouched.current) return;
    if (suggestion.kind !== readDraftMeta(draft.meta).kind) {
      draft.meta.set("kind", suggestion.kind);
    }
  }, [suggestion, draft]);

  const setMetaField = useCallback(
    (key: keyof DraftMeta, value: string) => {
      draft.meta.set(key, value);
    },
    [draft],
  );

  function onViewChange(next: string) {
    if (next === "markdown" && editor) {
      setMdDraft(editor.storage.markdown.getMarkdown());
    } else if (next === "rich" && editor) {
      // Commit the raw-markdown edits back into the shared rich doc.
      editor.commands.setContent(mdDraft);
      // setContent doesn't emit an "update" event, so the markdown-derived
      // state (the issue/epic suggestion) won't refresh on its own — resync it
      // explicitly, or a whole description written in the Markdown tab never
      // updates the kind hint.
      setBodyMarkdown(editor.storage.markdown.getMarkdown());
    }
    setView(next === "markdown" ? "markdown" : "rich");
  }

  async function onCreate() {
    if (!editor) return;
    setError(null);
    setSubmitting(true);
    const current = readDraftMeta(draft.meta);
    const title = current.title.trim();
    const body =
      view === "markdown" ? mdDraft : editor.storage.markdown.getMarkdown();
    try {
      let dest: string;
      if (current.kind === "epic") {
        const res = await authedFetch(`/api/repos/${owner}/${repo}/mind-epics`, {
          method: "POST",
          body: JSON.stringify({ title, body: body.trim() || undefined }),
        });
        await throwIfBad(res);
        // Empty epics aren't deep-linkable; land on the board where the new
        // epic group now shows (0 issues).
        dest = `/repos/${owner}/${repo}/issues`;
      } else {
        const res = await authedFetch(`/api/repos/${owner}/${repo}/mind-issues`, {
          method: "POST",
          body: JSON.stringify({
            title,
            type: current.type,
            epic: current.epicSlug,
            priority: current.priority,
            body: body.trim() || undefined,
          }),
        });
        const data = (await throwIfBad(res)) as { issue: { number: number } };
        dest = `/repos/${owner}/${repo}/issues/${data.issue.number}`;
      }
      router.push(dest);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  async function onShare() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  const labelClass =
    "text-[10px] uppercase tracking-[0.22em] text-[color:var(--ink-faint)]";
  const mono = { fontFamily: "var(--font-mono-src)" };
  const isEpic = meta.kind === "epic";
  const canCreate = isOwner && meta.title.trim().length > 0 && !submitting;
  const collab = draft.provider !== null;

  return (
    <div className="flex flex-col gap-5">
      {/* Presence + connection */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block h-2 w-2 rounded-full"
            style={{
              background: !collab
                ? "var(--ink-trace)"
                : connected
                  ? "var(--status-ok)"
                  : "var(--ink-faint)",
            }}
          />
          <span className={labelClass} style={mono}>
            {!collab ? "local-only" : connected ? "live" : "connecting"}
          </span>
          {collab ? (
            <>
              <span aria-hidden style={{ color: color }} title="you">
                ▎
              </span>
              {peers.map((p) => (
                <span
                  key={p.id}
                  title={p.name}
                  className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-semibold text-white"
                  style={{ background: p.color }}
                >
                  {p.name.slice(0, 2).toUpperCase()}
                </span>
              ))}
            </>
          ) : null}
        </div>
        {collab ? (
          <Button type="button" variant="outline" size="sm" onClick={onShare}>
            {copied ? "Link copied" : "Share draft"}
          </Button>
        ) : null}
      </div>

      {/* Title */}
      <label className="flex flex-col gap-1.5">
        <span className={labelClass} style={mono}>
          Title
        </span>
        <Input
          type="text"
          maxLength={160}
          value={meta.title}
          onChange={(e) => setMetaField("title", e.target.value)}
          placeholder="Short, imperative summary"
          disabled={submitting}
        />
      </label>

      {/* Kind toggle + suggestion */}
      <div className="flex flex-col gap-1.5">
        <span className={labelClass} style={mono}>
          Kind
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <ToggleGroup
            type="single"
            value={meta.kind}
            onValueChange={(v) => {
              if (!v) return;
              kindTouched.current = true;
              setMetaField("kind", v);
            }}
          >
            <ToggleGroupItem value="issue">Issue</ToggleGroupItem>
            <ToggleGroupItem value="epic">Epic</ToggleGroupItem>
          </ToggleGroup>
          <span className="text-xs text-[color:var(--ink-soft)]">
            💡 {suggestion.reason}
            {suggestion.kind !== meta.kind ? (
              <button
                type="button"
                className="link ml-1"
                onClick={() => {
                  kindTouched.current = true;
                  setMetaField("kind", suggestion.kind);
                }}
              >
                use {suggestion.kind}
              </button>
            ) : null}
          </span>
        </div>
      </div>

      {/* Issue-only axes */}
      {!isEpic ? (
        <div className="flex flex-wrap gap-5">
          <label className="flex min-w-[150px] flex-1 flex-col gap-1.5">
            <span className={labelClass} style={mono}>
              Type
            </span>
            <Select
              value={meta.type}
              onValueChange={(v) => setMetaField("type", v)}
              disabled={submitting}
            >
              <SelectTrigger style={mono}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={mono}>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex min-w-[150px] flex-1 flex-col gap-1.5">
            <span className={labelClass} style={mono}>
              Epic
            </span>
            <Select
              value={meta.epicSlug}
              onValueChange={(v) => setMetaField("epicSlug", v)}
              disabled={submitting}
            >
              <SelectTrigger style={mono}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={mono}>
                <SelectItem value="general">General (un-epic&apos;d)</SelectItem>
                {epics.map((e) => (
                  <SelectItem key={e.slug} value={e.slug}>
                    {e.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex min-w-[150px] flex-1 flex-col gap-1.5">
            <span className={labelClass} style={mono}>
              Priority
            </span>
            <Select
              value={meta.priority}
              onValueChange={(v) => setMetaField("priority", v)}
              disabled={submitting}
            >
              <SelectTrigger style={mono}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={mono}>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      ) : (
        <p className="text-xs text-[color:var(--ink-soft)]">
          An epic is a goal that groups issues — it just needs a title and a goal
          narrative below. Add issues to it afterwards.
        </p>
      )}

      {/* Body: WYSIWYG ⇄ markdown */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className={labelClass} style={mono}>
            {isEpic ? "Goal" : "Description"}
          </span>
          <Tabs value={view} onValueChange={onViewChange}>
            <TabsList>
              <TabsTrigger value="rich">Rich</TabsTrigger>
              <TabsTrigger value="markdown">Markdown</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {view === "rich" ? (
          <div className="mc-editor rounded border border-[color:var(--ink-trace)] bg-[color:var(--paper)]">
            <EditorToolbar editor={editor} />
            <div className="px-4 py-3">
              <EditorContent editor={editor} />
            </div>
          </div>
        ) : (
          <Textarea
            rows={16}
            value={mdDraft}
            onChange={(e) => setMdDraft(e.target.value)}
            placeholder={"## What\n\n…\n\n## Acceptance criteria\n\n- [ ] …"}
            style={{ fontFamily: "var(--font-mono-src)" }}
          />
        )}
        <p className={labelClass} style={mono}>
          {view === "markdown"
            ? collab
              ? "raw markdown — switch back to Rich to merge your edits into the shared doc"
              : "raw markdown — switch back to Rich to merge your edits into the draft"
            : collab
              ? "everyone in this room edits together · changes sync live"
              : "local draft · saved in this browser until you create it"}
        </p>
      </div>

      {error ? (
        <p
          className="rounded border px-3 py-2 text-sm"
          style={{
            borderColor: "var(--status-bad)",
            color: "var(--status-bad)",
            background: "color-mix(in srgb, var(--status-bad) 8%, transparent)",
          }}
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Button type="button" onClick={onCreate} disabled={!canCreate}>
          {submitting
            ? "Creating…"
            : isEpic
              ? "Create epic"
              : "Create issue"}
        </Button>
        {!isOwner ? (
          <p className={labelClass} style={mono}>
            you can co-draft · the repo owner commits it to <code>.mind</code>
          </p>
        ) : (
          <p className={labelClass} style={mono}>
            commits a <code>.mind</code> {isEpic ? "epic" : "issue"} · folded &amp; pushed to the repo
          </p>
        )}
        <Link
          href={`/repos/${owner}/${repo}/issues`}
          className="link text-sm"
        >
          cancel
        </Link>
      </div>
    </div>
  );
}

/** Compact formatting toolbar — the WYSIWYG affordances over the TipTap editor. */
function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null;

  const Btn = ({
    label,
    title,
    active = false,
    onClick,
    style,
  }: {
    label: string;
    title: string;
    active?: boolean;
    onClick: () => void;
    style?: React.CSSProperties;
  }) => (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      // Keep the editor selection while clicking the button.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="rounded px-2 py-1 text-xs leading-none transition-colors hover:bg-[color:var(--paper-soft)]"
      style={{
        fontFamily: "var(--font-mono-src)",
        color: active ? "var(--accent-deep)" : "var(--ink-soft)",
        background: active
          ? "color-mix(in srgb, var(--accent) 16%, transparent)"
          : "transparent",
        ...style,
      }}
    >
      {label}
    </button>
  );

  const Sep = () => (
    <span aria-hidden className="mx-1 h-4 w-px bg-[color:var(--ink-trace)]" />
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-[color:var(--ink-trace)] px-2 py-1.5">
      <Btn
        label="B"
        title="Bold (⌘B)"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
        style={{ fontWeight: 700 }}
      />
      <Btn
        label="I"
        title="Italic (⌘I)"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        style={{ fontStyle: "italic" }}
      />
      <Sep />
      <Btn
        label="H2"
        title="Heading"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      />
      <Btn
        label="H3"
        title="Subheading"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      />
      <Sep />
      <Btn
        label="• List"
        title="Bullet list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <Btn
        label="1. List"
        title="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <Btn
        label="☑ Task"
        title="Checklist"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />
      <Sep />
      <Btn
        label="❝ Quote"
        title="Block quote"
        active={editor.isActive("blockquote")}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      />
      <Btn
        label="</> Code"
        title="Code block"
        active={editor.isActive("codeBlock")}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
    </div>
  );
}

async function throwIfBad(res: Response): Promise<unknown> {
  if (res.ok) return res.json();
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 || res.status === 403) {
    throw new Error("Sign in as the repo owner to commit this draft.");
  }
  throw new Error(data.error ?? `request failed: ${res.status}`);
}

export type EditorHandle = Editor;
