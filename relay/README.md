# mind-codespaces collab relay

An **ephemeral** `y-websocket` room broker for the collaborative issue/epic
composer (`/repos/{o}/{r}/issues/draft/[id]`). One in-memory `Y.Doc` +
`Awareness` per room; the room id is the WS path. **No persistence, no pod
credentials** — it's a dumb pipe that forwards Yjs deltas + awareness (live
cursors) between peers. The durable store is git/`.mind` (the draft is committed
on "Create"); a per-browser IndexedDB cache covers reconnects.

Vendored verbatim from `mind-whiteboard-v1/relay/` because the relay is
content-agnostic — it has no idea whether it's syncing a whiteboard or an issue
draft.

## Dev

From the prototype root (deps are in the root `package.json`, so no separate
install is needed for dev):

```bash
npm run relay        # tsx relay/server.ts on :3012 (RELAY_PORT to override)
```

Health: `curl http://localhost:3012/health` → `{"ok":true,"rooms":N}`.

Live collaboration locally needs **both** `npm run dev` (:3010) and
`npm run relay` (:3012).

## Prod

No new image is required: point `NEXT_PUBLIC_COLLAB_RELAY_URL` at the deployed
**whiteboard** relay. The `mc:issue-draft:*` room namespace keeps the two apps'
docs from colliding. The `Dockerfile` here is kept only for the option of a
dedicated codespaces relay later (build context = this `relay/` dir).
