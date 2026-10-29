---
id: 01a151cd-c1e3-7205-b318-fbf3f76a8a50
title: Model connection is the new thread's empty state, not a banner above it
ord: 141
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151cc-c5c0-7801-9ff1-1db8867e133c",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/birth/connect.feed.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/birth/ConnectCard.svelte
  - kind: file
    ref: packages/chat-ui/src/ChatTranscript.svelte
---
Without a connected model, a new thread shows a "No model connected" card pinned above the feed, and below it, centered, the agent heading with suggestions that do nothing without a model: two competing centers on every new user's first screen.

Do: while no model is connected, connection is the thread's empty state — in place of the heading and suggestions; suggestions appear only after connection; the composer stays available for drafts. Keep the sign-in paths (Claude through CLI, ChatGPT through browser, API key) and clear the state cleanly the moment an account connects.

Proof: browser check on a personal tagma:try instance, typecheck, review, commit.
