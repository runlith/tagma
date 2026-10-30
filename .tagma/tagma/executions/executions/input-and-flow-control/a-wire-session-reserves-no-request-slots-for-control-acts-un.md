---
id: 01a0c71a-2023-7833-82f2-8599c956020d
title: A wire session reserves no request slots for control acts unless its budget sets controlRequests
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/executions/src/WireReaders.ts
  - kind: file
    ref: packages/executions/src/WireRequests.ts
  - kind: symbol
    ref: packages/executions/src/WireRequests.ts
    symbol: wireRequests
  - kind: symbol
    ref: packages/executions/src/WireSession.ts
    symbol: SessionBudget
---
Without a control share, traversal requests can occupy every slot, including the lane a keypress travels. A caller that needs input never to wait behind traversal declares a control share.