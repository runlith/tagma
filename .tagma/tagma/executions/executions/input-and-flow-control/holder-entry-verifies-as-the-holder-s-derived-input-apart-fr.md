---
id: 01a12a23-7d6c-7e33-8d97-1baecaa5b0e9
title: holder.entry verifies as the holder's derived input, apart from the parts' digest
ord: 7
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/execution-host/src/buildArtifact.ts
    symbol: buildArtifact
  - kind: symbol
    ref: packages/executions/src/hostArtifacts.ts
    symbol: holderEntryOf
  - kind: symbol
    ref: packages/executions/src/hostArtifacts.ts
    symbol: verifyArtifact
---
The file names its digest's boot input, so including its bytes in that same digest would make a circular dependency. Builder and verifier share one encoder: the verifier checks the whole file and its real path instead of excluding unknown bytes from the closure. That keeps a candidate from loading another build's input after the old logic falls.
