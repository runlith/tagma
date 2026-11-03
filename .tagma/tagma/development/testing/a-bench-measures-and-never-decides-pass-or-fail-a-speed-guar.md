---
id: 01a1a14f-0694-7a62-a11f-f0d3c380fb62
title: A bench measures and never decides pass or fail; a speed guarantee that must hold is a test over counted work, never over time
ord: 20
tags: ["rule"]
sources:
  - kind: dir
    ref: .
---
A `*.bench.ts` file, a stand's bench or baseline is a measuring program: it prints what something costs and runs by hand, outside every test run and CI gate. Wall and CPU time move with the machine and its load, so a threshold on them fails on the machine, not on the code.

A guarantee such as "one patch costs the same over 100 and 10 000 entries" becomes a test only where its owner already counts the work — rows touched, statements run, processes started. A counter added for the test alone is a test seam.
