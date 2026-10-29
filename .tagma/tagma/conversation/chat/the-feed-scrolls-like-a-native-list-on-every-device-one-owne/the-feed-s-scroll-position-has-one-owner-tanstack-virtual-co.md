---
id: 01a18353-fc02-75a8-8ad8-55e6ba48c4e2
title: "The feed's scroll position has one owner: tanstack virtual-core 3.19.8 without Tagma's writers, estimates per kind and width, phone gestures"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18355-1f69-798e-a682-a0155df159f7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: dir
    ref: packages/scroll-follow
  - kind: file
    ref: packages/chat-ui/src/ChatComposerOverlay.svelte
  - kind: file
    ref: packages/chat-ui/src/rowEstimate.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptViewport.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptVirtualizer.svelte.ts
---
Parts 3, 4 and 5 of [[2ea21922]]: upgrade virtual-core to 3.19.8 through the package manager; delete `applyPrepend` and its hold/track/release calls, `reanchorEnd`, `pinResizedRows`, the `scrollToFn` suppression, `chasing`, the gesture-window authorship and `FollowingViewport`'s writes; follow through the library; meet the spec's contracts (position, writes, authorship, following, paging, sizes, mounted rows, rail, phone). Accepted only on the feed stand's budgets.