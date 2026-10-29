---
id: 01a14778-d9b9-75fe-b78a-3d87bbc718ce
title: "Feed: empty band under a row from a height recorded onto someone else's key"
ord: 50
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1474e-5986-7840-bfed-6e1ab1b74508",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/chat-ui/src/TranscriptRow.svelte
  - kind: file
    ref: packages/chat-ui/src/TranscriptVirtualizer.svelte.ts
---
Sometimes an empty band hundreds of pixels tall stands under a feed row (e.g. the "Worked · N steps" header): the window holds someone else's height for the row.

Cause: `TranscriptVirtualizer` knew a row by its `data-index` attribute, while the DOM index lags the model. `sync` set a new model and at once re-measured mounted nodes with stale indexes, so a node's height went to the key standing at that index in the new model. Also, a window rebuilt over already-mounted rows (thread change with the same keys) never observed them, and they lived on an estimate.

Done: rows are known by key (`data-timeline-key` on the measured node, `indexFromElement` takes the index from the current model), mounted rows re-measure after `setOptions` and `publish`, and a rebuilt window accepts them at once. Check: `TranscriptVirtualizer.svelte.test.ts` tests "whose height a mounted row gives".
