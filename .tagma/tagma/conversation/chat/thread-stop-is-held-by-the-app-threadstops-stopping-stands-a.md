---
id: 01a15f54-de56-72d9-a496-523fba6eaccf
title: "Thread stop is held by the app ThreadStops: `Stopping…` stands along the turn until the frame with its end, only its own stop returns words"
ord: 62
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/src/session/ThreadStops.svelte.ts
---
One `ThreadStops` of the app holds a thread's stop: "Stopping…" stands along the turn until the frame with its end, and only its own stop returns words.

One `ThreadStops` per project (`ThreadChats.of`) serves the chat, the thread-list menu, and previews, so a repeated press on the same turn sends nothing, wherever it was pressed from. The command goes in the app scope, and the press only waits for its answer: leaving the thread and closing the slot do not cut the wait.

The entry stands under the thread and turn. An end nobody saw (the thread open in no session) does not pass the next turn off as "being stopped": it has another id, and a stop goes out over it again.

The request names no turn, so the server stops its current one, and until the answer the client does not know which turn stopped. Until the answer arrives, "Stopping…" stands on any turn of the thread, and a frame where the turn from the screen changed to someone else's end is only remembered: the answer names the stopped turn, and when the remembered end is it, the entry is removed and words return by it. After the answer the entry is removed by a frame carrying another turn or none. A `stopped` answer does not remove it — the frame shows the end; `requested` moves to "Being stopped"; `nothing-running`, `run-mismatch`, and refusal remove at once.

The server puts the revoked turn's words into `status.ending.words` and repeats them in every snapshot until that is the last end. So only the frame that removed this page's stop and asked for the return gives them back to the draft — otherwise the words would return on every reconnect and in every tab. While such a stop waits for the end, `PendingTurns` reads the thread feed even without an open session (`StatusWatch.wants`).
