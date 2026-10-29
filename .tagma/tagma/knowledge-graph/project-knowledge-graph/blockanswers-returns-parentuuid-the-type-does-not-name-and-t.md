---
id: 01a0caa9-db17-71c8-9401-fdb280fbbef8
title: "`blockAnswers` returns `parentUuid` the type does not name, and two readers cast for it"
ord: 209
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/acts/measurement.ts
    symbol: blockAnswers
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/answers.ts
    symbol: blockSummary
  - kind: symbol
    ref: apps/tagma/server/src/graph/reading/rows.ts
    symbol: wireTreeBlock
---
`blockAnswers` attaches `parentUuid` to every row it returns, but `BlockRecord` names only the input row and the measured marks — so `reading/rows.ts` and `operations/answers.ts` read the field they know is there through a cast.

Done when `parentUuid` is part of the declared return type and both casts are gone.