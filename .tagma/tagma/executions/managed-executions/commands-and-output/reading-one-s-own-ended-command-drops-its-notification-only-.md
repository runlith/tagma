---
id: 01a130e2-fd2a-7914-a108-f38ed104ff7a
title: Reading one's own ended command drops its notification only once the checkout measurement already stands
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/output.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/commands/waiters.ts
    symbol: CommandNoticeQueue
---
A background command's end notification carries two facts: completion at the host and the checkout measurement, which bash writes slightly later (`CommandWaiters.measured`). The owner thread's `read_output`, having answered the end in full together with the measurement, takes the notification debt, and the end never arrives twice. A read before the measurement takes no debt: it answers without the measurement, and the notification arrives later already carrying it — otherwise the checkout measurement would never reach the thread at all.
