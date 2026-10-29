---
id: 01a11288-8995-767f-b076-ebcb751b6102
title: Give ThreadCompactionStrategy.summarize a typed model error instead of Effect.die, so COMPACTION ends with its own cause
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c17-b1ec-77e1-b49d-4fb1178ad9cf",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11269-a3ce-7ee4-b5ba-178403b34468
sources:
  - kind: file
    ref: packages/agent/src/thread/compaction/strategy.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/summaryStrategy.ts
---
`SummaryStrategy` turns a typed `LLMError` (except context overflow) into a defect: the `compaction` activity ends `failed`/`Defect` instead of with the provider's cause. Do: carry the `LLMError` in `ThreadCompactionRefused` (or a separate `summarize` error channel), thread it through `ThreadCompaction` into the compaction outcome. Done when a model failure in compaction reads in `read_thread select:activity` with `reason` = the LLM cause tag, and a compaction test checks it.
