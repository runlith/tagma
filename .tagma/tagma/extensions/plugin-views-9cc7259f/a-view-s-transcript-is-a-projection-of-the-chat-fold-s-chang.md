---
id: 01a1b19f-032d-713a-befb-6441ccb6b2fb
title: A view's transcript is a projection of the chat fold's change log, served through a port threads fills
ord: 2
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14bc0-7704-77d5-b31a-ec5a94567243
  - kind: relates
    to: 01a1ad4a-de84-7ddc-9396-cf6ac4451a7e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/transcript.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/ThreadTranscripts.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/transcriptHost.svelte.ts
---
A view's transcript is the chat fold seen through one projection, and what the view receives is the fold's change log, not the feed's frames. `ChatFold` already folds the run stream into the entries a pane draws and keeps its last sixteen change batches (`since(revision)`); `TranscriptFollow` maps only the entries those batches touched, so a streamed token costs one entry, and a second fold of the wire events never exists. When the log no longer reaches the view's revision, or an entry comes back in front of one already sent (an undone rewind), the follower sends a fresh `initial` and the view replaces what it holds.

What is "in flight" follows the fold's own placement: a reply still streaming and a tool call whose input is still arriving sit after the settled entries and move to the end of them when they land, so they are the `tail`. A tool call with its input complete is an ordinary entry that changes in place, which keeps parallel calls in call order. The tail sends the appended text of one streaming reply, and the whole tail again when anything else in it changes; the append is trusted only when the fold marks the new text as grown from exactly the text already sent.

The window reaches the chat session through the `ThreadTranscripts` port the view module declares and `threads` fills from `ThreadChats` (the view module is imported by `threads`, so it cannot import it). Each watched thread is one session and one `thread.subscribe`: `ThreadChats` shares nothing between a view and a pane on the same thread, because a pane's session belongs to its thread scope (`ThreadFeed`) and a view holds no thread scope. A session a pane closed leaves its fold in `DetachedSessions`, and the next session of the thread takes it up warm.
