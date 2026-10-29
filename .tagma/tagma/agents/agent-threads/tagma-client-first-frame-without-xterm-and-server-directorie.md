---
id: 01a10284-da13-7e0c-9742-a42ff8547949
title: "Tagma client: first frame without xterm and server directories; threads list and tool input are O(changes)"
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e88-78a0-b17d-3889571d4916",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/List.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/tree.ts
  - kind: file
    ref: apps/tagma/app/src/routes/+layout.svelte
  - kind: file
    ref: packages/agent/src/agent/AgentMessageFold.ts
---
**What.** The client's first frame does not load heavy code it does not need; the threads list and tool input update in O(changes).

**Why (perf audit 2026-10-03).**
1. Bundle. Root layout (`apps/tagma/app/src/routes/+layout.svelte`) pulls modulepreload 51 JS — 3 855 785 B raw / 1 137 144 B gzip (measured on installation 20261003T143440716Z): a 1.78 MB chunk with @xterm/xterm and addons (webgl, ligatures, serialize, search), zod, chat-ui; a ~0.9 MB chunk with Effect, query-core, server `contract/wire/operations/*Catalog.ts` and `inspection/src/packs/architecture/*/declaration.ts`. That is parse/compile before the first frame and a cold desktop start.
2. `packages/agent/src/agent/AgentMessageFold.ts:173-181` calls `readPartialJson(the whole accumulated text)` on every `tool-input-delta` — O(L²) for write, edit, apply_batch; a new `input` object on every delta breaks `sameEntry`. The incremental `partialJsonReader` already exists (`agent/turn/call.ts:151`). The server does not use this path — the client only.
3. `apps/tagma/app/src/lib/features/threads/List.svelte.ts:152-226`, `tree.ts:40`: every row-frame — O(T) `find` and copy, sort on shift; `threadTree` builds children via `[...(byParent.get(p) ?? []), row]` — O(k²) per parent; end of run, pin removal, unfile and reparent re-read the whole root window over HTTP (`refreshWindow`); `ThreadList.threads` — deep `$state`.

**Direction.** The terminal engine is a dynamic import where the panel mounts; in the browser path — wire types without runtime directories and inspection declarations. A partial-JSON Reader on the tool call with `push(delta)`. Children by push; a frame applies without re-reading the window while the row stays in the window; `$state.raw` for the list.

**Done when.** The first frame does not load xterm or server directories (modulepreload before and after); the tool input assembles incrementally with the same result; the list frame neither copies nor re-reads the window, the tree order and composition unchanged.
