---
id: 01a0cad3-a4db-7b8a-9666-ee8146611756
title: Dead subject producers in `terminalSubjects.ts` beside the used local copies
ord: 56
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/subjectPolicy.ts
---
`terminalSubjects.ts` exports `observationSubjects` and `operationReadSubjects`, called by nothing — `protocol/operations/terminals.ts` carries its own local copies of the same spelling and those are the ones the entries use. Two spellings of the subject strings now stand side by side, and only one of them prices anything.

Done when the dead exports go (leaving the used copies as the one spelling) or the entries read the shared ones — one spelling, named once.