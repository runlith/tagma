---
id: 01a126b9-6a5d-780b-8049-42203ce4493a
title: The client keeps its place and unsent message across reload and reconnects quickly in the window
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126ba-63f9-78d6-8a0e-a22ce9dff8d7",
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ebd801f443
---
The part of the spec that needs no new server code: the feed anchor and the unconfirmed send with a key survive page reload; draft attachments finish writing before reload; the channel reconnects frequently in the restart window; `/health` polling has a per-attempt deadline; one owner starts the reload on build change; the desktop window returns to the last address. Start with `apps/tagma/app/src/lib/wire/Live.ts`, `apps/tagma/app/src/lib/app/chrome/Standing.svelte.ts`, `packages/chat-ui/src/session/PendingTurns.ts`, `packages/chat-ui/src/TranscriptViewport.svelte.ts`, `apps/tagma/desktop/src/main.ts`. Done when the send and anchor checks from "What the implementer proves" pass.
