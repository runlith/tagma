---
id: 01a0c71c-fb17-797a-9752-2f3e26430db4
title: "`pid` and port match another only inside one scope: the caller compares namespaces before comparing numbers"
ord: 2
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/evidence.ts
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: EvidenceScope
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: sameScope
---
