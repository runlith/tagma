---
id: 01a12801-399c-7640-b215-676e8a8366df
title: Record diagnostics ride inside the single lifecycle hook observation
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a127ef-4a2f-7da7-a56a-051ed17b7667
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
    symbol: report
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/terminal/events.ts
    symbol: TerminalEvents.act
---
One captured event carries one `capturedAt`: a repeat of the same lifecycle event with separate diagnostics could execute Stop ahead of the final answer or be refused as stale evidence. When an ordinary report is assembled, the diagnostics already received join it and are recorded into the run together with it; on their own they never serve as a reason to open or close a run.
