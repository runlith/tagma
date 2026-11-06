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
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/transcriptReading.svelte.ts
---
**Value.** A plugin view — a game table, a task board, a tutor — shows what the agent is doing and saying while it works, and lists the conversation itself, without polling or a server subscription of its own.

**How.** `useTagma().thread(threadId)` gives the thread's state now, and `useTagma().transcript(threadId)` gives its transcript, each as a reactive value the view reads in its markup. Under the state is the server's live `threads.presence` feed; under the transcript, the chat session the window opens for the thread, as a pane does.

**Behaviour.**
- The state: whether a run is going, the last spoken line or the answer text as it generates, and how the last run ended, updated as they change. Observations of one set of threads share one subscription.
- The transcript: the newest page of entries (user words, replies, tool calls with their state, questions, notices), with older pages on demand and what is still being written as its tail. The reply grows as text arrives, and a tool call shows `running` until it ends. A rewound or withdrawn entry leaves the list. The model's reasoning is never part of it. A transcript costs one chat session of its own, a second subscription when a pane shows the same thread.
- Each is followed only while something in the view reads it, and ends with the view.

**Limits.** A foreign, deleted or nonexistent thread reads as missing with a cause. A transcript that cannot be read carries the reason as its failure, and reading it again later opens it afresh. The transcript carries no timestamps and no attachments.
