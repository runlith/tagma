---
id: 01a150a3-4436-7f60-9f84-29b7a863b457
title: Inline code in a streaming agent reply sends `place_path` for every intermediate text variant
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a150a3-6b1d-7521-98c5-0ed2da9d0db6",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15099-cd9e-701b-a6c4-f1832352d112
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/MarkdownBody.svelte
---
While the reply is still printing, a single span `Good day, Ana. How may I help?` fires `place_path` requests with paths "Good", "Good day,", "Good day, Ana.", … — one per stream word, for every user on every reply containing inline code. Find the owner that recognizes code as a path, and resolve the path at the closed record instead of the open one; proof is a single request per span after the stream ends (in the demo this shows in the console: `[demo] not in the recording: POST /api/op/place_path`).
