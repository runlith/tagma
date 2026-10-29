---
id: 01a128f3-3e3d-7ac0-9b34-2d2b06237037
title: A terminal input reset stops the accepted paste at the interrupt-delivery boundary
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionInput.ts
  - kind: symbol
    ref: packages/execution-host/src/holder/Holder.ts
    symbol: Terminal
  - kind: symbol
    ref: packages/execution-host/src/ptyLaunch.ts
    symbol: sinkOf
---
On interrupt without NOFLSH the tty kernel drops taken input but not the host's queue. So the adapter synchronously tells the sink of the drop before the writer can wake on the freed space: ExecutionInput interrupts the current write and suspends drain until old bytes are removed. Taken queued and in-flight bytes stay counted as abandoned, while new writes and the interrupt-receipt retry keep the usual contract. Notification belongs to the transport; ExecutionInput never reads termios.
