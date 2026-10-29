---
id: 01a1524c-19f5-74da-a53e-e0cb6275866c
title: The SQL seed of open questions holds live rows and only records changed by suffix
ord: 25
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1520d-d830-738b-b878-20699c5f7df9
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/fold.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/rows.ts
---
Out-of-run approvals accumulate under one scope for the thread's whole life, so picking the next question must not decode closed history. Live rows are read through a partial index on each layered arm; records changed by the not-yet-folded suffix are added by entry-id. These closed candidates are needed to keep ordinal and rewind metadata when a question reopens; then the suffix folds as usual. Prefix-shadowing applies before selection so a closed own branch record does not open a hidden ancestor record.
