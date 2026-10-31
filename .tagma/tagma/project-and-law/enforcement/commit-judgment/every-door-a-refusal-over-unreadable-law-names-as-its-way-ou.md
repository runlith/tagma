---
id: 01a18c5f-0908-7940-8a8c-6b887494484b
title: Every door a refusal over unreadable law names as its way out stays open while that law does not read
ord: 13
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a18c36-4a00-7ff9-a9a3-e670d6481c3f
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/judge.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/judging/ruleChecks.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/reach.ts
---
While the vocabulary or a rule's enforcement document does not read, nothing says which rules run before an operation, so every agent operation that changes nothing is judged and refused — except the ways out in `judge.ts`. The refusals over unreadable law send the caller to doors that say why and name each unreadable declaration with how to correct or delete it; every such door belongs to the ways out. One missing turns recovery into a loop while every commit of the project stays refused: read_enforcement pointed at read_vocabulary, and the gate refused read_vocabulary.