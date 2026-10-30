---
id: 01a0c71c-fb17-797a-9752-2f3e26430db4
title: Compare a pid or port with another only when both come from the same evidence scope
ord: 2
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: EvidenceScope
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: sameScope
---
Compare the scopes with `sameScope` before comparing numbers: the same number in another host or network namespace names another thing.