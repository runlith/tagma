---
id: 01a1694d-39b3-75b6-a2cb-474d0b9d8d39
title: Setting chips in finished answer blocks during the stream, and stream end no longer recreates finished blocks
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16946-e02f-7a00-8093-9990c2e5b502",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a165cd-9463-754c-83d4-701e195e3de6
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/MarkdownBody.svelte
  - kind: file
    ref: packages/markdown/src/render.ts
  - kind: file
    ref: packages/markdown/src/stream.ts
---
The setting chip appeared only after stream end: `MarkdownBody` placed no chips while `streaming`. No objective reason — the catalog is already in the client, matching is cheap. The one real constraint: the live tail draws from healed `remend` text, and an unclosed inline code in it (`` `agent.keepWarm`` on the way to `agent.keepWarmPings`) is already `<code>`.

The second cause of lost chips and highlights is stream end: `Body.read` with `streaming: false` drew the whole body again as one block with key `'0'`, and the keyed `{#each}` recreated the whole message's DOM.

**To do.** Render marks a block drawn from the healed tail; `MarkdownBody` places chips in every unhealed block at once. Stream end closes the tail with the same block splitting: finished blocks keep the same values, only the tail redraws. A body that never streamed draws whole, as before.

**Done when.** A chip stands in a finished block while the answer still streams, and not in the live tail; after stream end the finished blocks' DOM is the same; the HTML of a stream-closed body matches the HTML of the same text drawn whole.
