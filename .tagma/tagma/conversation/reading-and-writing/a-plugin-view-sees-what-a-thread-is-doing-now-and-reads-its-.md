---
id: 01a14bc0-7704-77d5-b31a-ec5a94567243
title: A plugin view sees what a thread is doing now and reads its transcript live
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
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/transcript.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/transcript.ts
---
**Value.** A plugin view — a game table, a task board, a tutor — shows what the agent is doing and saying while it works, and lists the conversation itself, without polling or a server subscription of its own.

**How.** The view bridge's `tagma/thread` and `tagma/thread/unwatch` give the thread's state now; `tagma/transcript`, `tagma/transcript/older` and `tagma/transcript/unwatch` give its transcript. Under `tagma/thread` is the server's live `threads.presence` feed; under `tagma/transcript` the chat session the window opens for the thread, as a pane does.

**Behaviour.**
- The state: the view gets the thread's initial state, then changes — whether a run is going, the open question, the last spoken line, the outcome, the model, and the answer text as it generates. Observations of one set of threads share one subscription.
- The transcript: the newest page of entries (user words, replies, tool calls with their state, questions, notices), then `entry`, `removed` and `tail` events; the reply arrives as appended text and a tool call shows `running` until it ends. A rewound or withdrawn entry is `removed`. The model's reasoning is never part of it. A transcript costs one chat session of its own, a second subscription when a pane shows the same thread.

**Limits.** A foreign, deleted, or nonexistent thread arrives as absent with a cause in `tagma/thread`, and refuses `tagma/transcript` with its reason. Both observations end with the view. The transcript carries no timestamps and no attachments.
