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
The Load panel and the status bar show Tagma's total as the sum of the `Installation` and `Execution` groups. So when the reading is squeezed under the frame envelope, Tagma's groups pack first. If one of them fits not even without processes, its CPU and memory join the `Installation` group, not the shared "Other programs". Otherwise the agent's work would go to "Rest of the Mac", and Tagma's total would read low exactly when the machine is overloaded. The move's price: a folded execution loses its line and stop button but stays in Tagma's total.
