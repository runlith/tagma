---
id: 01a1a842-ffbd-7510-b60a-278ab69cd50b
title: The host offers Lowest only where its holder can raise the work back
ord: 16
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/Tempo.ts
---
Work lowered beyond recall would stay slow after the operator returns the machine to Full. Linux raises a nice value only with CAP_SYS_NICE, so a holder without it launches requested-Lowest work at Full and announces no `pace-raise`; the tempo port then offers no Lowest move at all, and a pace change reports that work as kept rather than attempting a move each process refuses. macOS always raises, so it offers both directions.