---
id: 01a126df-ec0c-72df-9860-24c70707eeba
title: The feed anchor holds any row, and recovery scrolls from the tail within a budget and says when it did not reach it
ord: 5
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-42203ce4493a
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ebd801f443
sources:
  - kind: file
    ref: packages/chat-ui/src/TranscriptViewport.svelte.ts
---
After 3ce4493a the anchor takes only message rows: a page standing entirely on action or tool-result rows does not keep its place and opens at the tail after reload. In agent threads most rows are actions, so the "same row" promise does not hold there. Any feed row must be able to anchor. Recovery scrolls from the tail until it reaches the anchor or exhausts its byte and time budget; the 30-page limit goes away, and when the anchor is beyond the budget the feed stays at the tail and says so in one status row. An address window around the record needs a new server operation and a new feed mode and is out of scope here. Start with `packages/chat-ui/src/TranscriptViewport.svelte.ts`. Done when a feed standing on an action row in history stands on it again after reload.
