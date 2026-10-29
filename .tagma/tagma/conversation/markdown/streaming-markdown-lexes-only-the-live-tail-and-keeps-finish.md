---
id: 01a10284-da13-7e0c-9742-a42ebd97b8b4
title: Streaming markdown lexes only the live tail and keeps finished blocks' DOM
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e83-7e67-a59c-2600dbd23849",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/MarkdownBody.svelte
  - kind: file
    ref: packages/markdown/src/render.ts
  - kind: file
    ref: packages/markdown/src/stream.ts
---
**What.** Streaming markdown costs O(delta): a message's finished blocks are not re-lexed and do not recreate DOM.

**Why (perf audit of 2026-10-03, from code).** `apps/tagma/app/src/lib/features/graph/MarkdownBody.svelte:26-59`, `packages/markdown/src/render.ts:41-74,84-122`, `stream.ts:11-44`: per delta — `marked.lexer(all text)`; with reference definitions the whole text is one live block, parsed and cleaned by DOMPurify whole; a new `Marked` with extension `use()` per changed block; `{@html html}` recreates the DOM of all finished blocks; then `querySelectorAll('a[data-block-ref]')` with `peerOf` per link, and remeasure. O(L²) per message: a 20 KB answer at ~1000 deltas is seconds of main thread in total (estimate). Streaming loses text selection. Without `cacheKey` the render cache key is the whole body (`MarkdownBody.svelte:37`); the global cache of 400 entries holds key, raw and html.

**Direction.** The markdown owner holds the stable-prefix offset per render key and lexes only the tail; one parser per (theme, extensions); emits blocks separately, and `MarkdownBody` renders a keyed `{#each}` over blocks, so finished blocks keep their DOM; the cache key is short and never equals the body.

**Done when.** A delta lexes and sanitizes only the live tail; finished blocks' DOM is not recreated; a finished message's HTML matches the previous render; total cost of streaming a 20 KB answer is linear in length.
