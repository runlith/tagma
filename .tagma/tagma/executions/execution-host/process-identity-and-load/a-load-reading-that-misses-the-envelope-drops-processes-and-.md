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
The Load panel and the status bar show Tagma's total as the sum of the `Installation`, `Part` and `Execution` groups. When the reading is squeezed under the frame envelope, those groups pack first. An installation group folded without its processes keeps its role; a folded part or execution joins a separate installation overflow, never the shared other-programs group. Otherwise Tagma's total would read low or a known host figure appear on the server. A folded group loses its own line and action but stays in Tagma's total.
