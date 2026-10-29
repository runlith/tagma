---
id: 01a12d5d-e1f3-7783-9b83-5490de760e1b
title: Native read_journal shows act batches and writer instead of a block list
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4f062231df",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12d53-c3f3-75e1-8efd-e6bb004384e7
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/toolAnswers.ts
  - kind: file
    ref: apps/tagma/server/src/graph/voice/answers.ts
  - kind: file
    ref: apps/tagma/server/src/graph/voice/display.ts
---
The native graph voice recognizes a JournalPage separately from a BlockList: it keeps batch order, ops and act count, event ids and timestamps, session id, and the writer's full string identity, nextBefore with the filter-keeping condition. The footer states total not counted explicitly; display counts the page's batches. The provenance loss is reproduced on the native model-text boundary ("1 of undefined") and closed red→green; 12 narrow tests and typecheck pass. Sol and two Muse reviews done, confirmed remarks fixed. Backend batching and the JSON CLI unchanged; the operator's running server not updated.
