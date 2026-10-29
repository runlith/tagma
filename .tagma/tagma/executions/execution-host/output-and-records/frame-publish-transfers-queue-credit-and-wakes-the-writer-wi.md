---
id: 01a14df2-8775-7759-b87a-f6ea101912a7
title: Frame publish transfers queue credit and wakes the writer with no interruption window
ord: 8
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13d2f-397e-77cc-90c3-6f03bdb21bcd
sources:
  - kind: symbol
    ref: packages/execution-host/src/ConnectionWriter.ts
    symbol: makeConnectionWriter
---
Waiting for a free credit is interruptible; once it arrives, enqueue and the writer wake-up form one uninterruptible step. Otherwise a cancelled subscription could hold credit with no frame queued, and an interrupted reply could leave an already queued frame unwoken. The posted event's credit is returned by the drain after the write, so a finishing publisher never frees it before delivery.
