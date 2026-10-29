---
id: 01a0c71c-fb27-73cd-84d7-5e2569128217
title: Never act on a pid whose identity is unproven as on the process the execution started
ord: 4
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/evidence.ts
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: identityMatch
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: IdentityMatch
---
`unknown` with a missing birth or an unread witness does not mean same. A relation the kernel established may be reported; an act requiring identity must not be performed.
