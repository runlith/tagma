---
id: 01a14111-9fb4-75e5-9d6a-2672e88fa891
title: A load reading that misses the envelope drops processes and address lines but never moves Tagma's work to other people's programs
ord: 7
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/execution-host/src/ProcessUsage.ts
    symbol: bounded
---
The Load panel and the status bar show Tagma's total as the sum of the `Installation`, `Part` and `Execution` groups. When the reading is squeezed under the frame envelope, those groups pack first. If one fits not even without processes, its CPU, GPU and memory join the `Installation` group, not the shared other-programs group. Otherwise Tagma's total would read low exactly when the machine is overloaded. A folded group loses its own line and action but stays in Tagma's total.
