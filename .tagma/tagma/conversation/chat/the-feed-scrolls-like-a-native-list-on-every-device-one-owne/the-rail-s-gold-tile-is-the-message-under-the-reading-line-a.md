---
id: 01a18327-db3a-7478-a68b-f4b0f38a25ae
title: The rail's gold tile is the message under the reading line, also at the tail and while a run works
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18328-219e-70c1-b845-02e7015e958d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18327-c7aa-7718-b037-fece2ea21922
sources:
  - kind: file
    ref: packages/chat-ui/src/transcriptMessageNavigation.ts
  - kind: file
    ref: packages/chat-ui/src/TranscriptViewport.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/VisibleFeed.ts
---
Part 1 of [[2ea21922]]. While a run works the rail lights the message before the last at the tail and the last one once scrolled up: `VisibleFeed.activeMessage` returns the user message before the run's first entry, and a user message carries its own run's `runId`. Make the current message one geometric function — the last user message whose row starts at or above the reading line, the line moving from its fixed offset to the last visible pixel above the composer over the last viewport of scroll — and drop the run's message from the rail and from `Cmd+Alt+[`/`]` navigation.