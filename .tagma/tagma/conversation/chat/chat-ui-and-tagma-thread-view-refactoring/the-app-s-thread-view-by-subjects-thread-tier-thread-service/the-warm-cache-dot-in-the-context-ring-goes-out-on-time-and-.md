---
id: 01a12702-e165-77f6-a642-4f18550cf08e
title: The warm-cache dot in the context ring goes out on time and stands in the composer ring
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126ed-2548-7e92-91e0-2eb5ba9768cf",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/ContextRing.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/WallClock.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/ChatContextUsagePill.svelte
---
Two defects of the warm-cache dot in the context ring.

- The thread-row ring (`threads/native/ContextRing.svelte`) keeps its own clock: one `setTimeout` per `expiresAt`. The Chromium timer runs on monotonic clocks, which stand still during sleep on macOS, and can fire before `Date.now()`; after such a firing the ring stays warm forever, though Peek already writes "window passed".
- The composer ring (`chat-ui` `ChatContextUsagePill`) never receives warmth at all: the `ChatSurfaceContext` contract does not carry it.

Fix: `WallClock` gives deadlines on wall clocks (`watchDeadline`), checking against `Date.now()` and recomputing on window return; one reactive "is the cache warm now" is read by both rings; `ChatSurfaceContext` carries `warm`.

Proof: a `WallClock` test on a deadline the timer missed; app and chat-ui typecheck.
