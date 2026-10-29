---
id: 01a17f7a-7848-7ac9-9bac-5f3a2ce62660
title: After a late-turn rollback world state repeats the whole workspace, though early context messages still stand in history
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17f55-8e93-7de8-8618-0a7d71ad6e56",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17f5d-9e25-780b-9302-7f0783cb4628
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/message.ts
---
When told content is lost (`lost`: some run from `contextRuns` no longer stands in history — for example, the operator rolled back the last turn), `nativeTurnContext` drops the whole snapshot and retells every section: skill catalog, instruction files, workplace, fork mark. The early context messages still stand in history, and the model receives them twice — extra tokens on every turn after the rollback and duplicates in history.

Root: the snapshot does not know which run told each section's current value, so losing one run resets everything. More precisely — remember, for each section, the run that told its value, and on loss reset only the sections whose run left history. Found by review [[83cb4628]].
