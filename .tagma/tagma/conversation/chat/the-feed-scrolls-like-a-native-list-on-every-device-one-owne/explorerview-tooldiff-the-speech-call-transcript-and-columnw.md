---
id: 01a18353-fc64-7def-bbca-c08a4b92d687
title: ExplorerView, ToolDiff, the speech call transcript and ColumnWindow onto the feed's scroll owner; scroll-follow retires
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1845a-143f-7b6c-a78b-09e074740513",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/ExplorerView.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/speech/calls/TranscriptView.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ColumnWindow.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/entries/ToolDiff.svelte
---
Part 6 of [[2ea21922]], after the feed's owner lands: the other lists that window rows of measured height use the same owner and contracts; the speech call transcript keeps its playback centering; `@runlith/scroll-follow` and its module card retire once nothing imports it.