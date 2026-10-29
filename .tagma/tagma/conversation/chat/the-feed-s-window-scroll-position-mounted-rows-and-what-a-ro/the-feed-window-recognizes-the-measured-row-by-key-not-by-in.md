---
id: 01a14778-f056-76a3-822f-80720c2fae8e
title: The feed window recognizes the measured row by key, not by index
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14778-d9b9-75fe-b78a-3d87bbc718ce
sources:
  - kind: file
    ref: packages/chat-ui/src/TranscriptRow.svelte
  - kind: file
    ref: packages/chat-ui/src/TranscriptVirtualizer.svelte.ts
---
The measured `TranscriptRow` node carries `data-timeline-key`; `TranscriptVirtualizer` gives that key and its current row-model lookup to the shared list binding, which resolves the measurement's index. The DOM index attribute lags the model by a flush, and measuring by it recorded one row's height onto another key's — a row got someone else's height and an empty band that neither `ResizeObserver` (its node size never changed) nor a synchronous measure (it returns the recorded height) ever fixed.

Consequences: a row needs no re-measure when its index shifts; a window rebuilt with live nodes re-measures the mounted rows after `publish`, or they stay observer-less.
