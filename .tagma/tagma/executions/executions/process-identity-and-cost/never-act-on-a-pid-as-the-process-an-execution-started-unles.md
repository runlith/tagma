---
id: 01a0c71c-fb27-73cd-84d7-5e2569128217
title: Never act on a pid as the process an execution started unless its identity match is `same`
ord: 4
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: identityMatch
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: IdentityMatch
---
`unknown` — a missing birth or an unread witness — does not mean same. A relation the kernel established may be reported; an act that requires identity must not be performed.