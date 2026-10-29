---
id: 01a13fc1-da23-7199-9bf1-7a4c29ed9298
title: Reading four allowances requires printing every enforcement document
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "read_enforcement prints allowance counters, while their records come through read_inspections: even at limit:1 the answer holds all 17 enforced documents, 103,887 bytes, and is cut in the model preview.",
    "command": "read_enforcement({rule:\"ea465bed\",limit:1}); read_inspections({limit:1})",
    "expected": "Read the four current allowances with path/symbol/site/why and the ea465bed rule revision before the targeted key move."
  }
---
Filed from project `runlith`.

Moving the four adoption/adopt.ts keys took reading the shared inspection document with all the unrelated allowances. The layer is the enforcement read surface; external-harnesses code is not its concern. What is needed is a targeted reader for one rule's records without printing every document of the project.
