---
id: 01a17e18-541d-7f45-bf95-ef85c2da3d6f
title: The host shelf counts and evicts current-generation records shelved by the previous logic before its replacement
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17e19-3452-71aa-a697-3177d5ec942a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17e18-334d-79d8-9477-6b9e908f3f65
sources:
  - kind: file
    ref: packages/execution-host/src/RecordShelf.ts
---
By code reading, the new logic starts with an empty shelf (`keptBytes = 0` in `makeRecordShelf`), and `oldestGeneration` never selects the current generation. So previous-logic records of the same generation fall outside the 1/20 share and sit until the generation changes. First a test that fails on this scenario, then the fix at the shelf. Item 5 and criterion 5 of the spec.
