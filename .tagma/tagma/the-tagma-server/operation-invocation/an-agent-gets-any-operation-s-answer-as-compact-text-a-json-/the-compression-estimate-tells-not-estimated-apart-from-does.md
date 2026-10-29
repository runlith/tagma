---
id: 01a15f21-bed2-7038-8cfb-5a991e6926f4
title: "The compression estimate tells `not estimated` apart from `does not fit` instead of encoding both states as one `passes: null`"
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ac1-2b9a-7fc6-b993-3b1f606e8186",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15ec6-779b-7619-ae55-a53e0c002fab
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/compaction/choice.ts
---
The `read_compaction_choices` answer hands over `passes: null` both when no estimate was made and when the context does not fit the summarizer window. The operation voice tells them apart by `inputTokens === 0` — re-deriving a fact the producer should hand over (rule 51c66cb6). The fix belongs to the estimate owner: the answer carries a separate "not estimated" state, read by the voice and the app.
