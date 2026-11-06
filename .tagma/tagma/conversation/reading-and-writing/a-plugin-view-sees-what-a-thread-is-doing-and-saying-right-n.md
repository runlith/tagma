---
id: 01a14bc0-7704-77d5-b31a-ec5a94567243
title: A plugin view sees what a thread is doing and saying right now
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/presence
  - kind: dir
    ref: apps/tagma/server/src/threads/presence
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/presence.ts
---
**Value.** A plugin view — a game table, a task board — shows what the agent is doing and saying while it works, without polling or its own server subscription.

**How.** The view bridge's `tagma/thread` and `tagma/thread/unwatch` methods; under them the server's live `threads.presence` feed.

**Behaviour.** The view gets the thread's initial state, then changes: whether a run is going, the open question, the last spoken line, the outcome, the model — and the answer text as it generates. Observations of one set of threads share one subscription.

**Limits.** A foreign, deleted, or nonexistent thread arrives as absent with a cause. Observation ends with the view.
