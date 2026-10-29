---
id: 01a14c4e-7d20-7f6a-b9ef-01dddb8b7b76
title: Holdings input preparation reads texts and hunks only past the fold's cached prefix
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c20-33ed-7ba1-8f9f-0c865b054f35",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14c4e-7d20-7f6a-b9ef-01d8687ec37e
---
Build [[687ec37e]]: compare the fold memory against probe metadata before reading texts, and read texts and hunks only for lines past the cached prefix; the count of texts read is a `Holdings.inputs` attribute.

Start from `cachedOf` in `holdings/judge.ts`, `prepareAt` and `assembled` in `holdings/inputs.ts`, `FoldMemory` in `lines/memory.ts` and the `foldWork` input in `lines/fold.ts`.

Proof: a bench over 10 and 200 standing versions with numbers before and after; green Holdings itests.

## Result (4ee1213b80)

Bench `holdings.bench.ts` (`HOLDINGS_VERSIONS`), one sample on the operator machine: after one new edit a re-judge reads 2 version texts at both 10 and 200 standing versions (`holdings.texts` attribute of `Holdings.inputs`); time is 40–170 ms in both cases, the spread is noise. Before the change it read the text of every distinct version: 11 and 201 — concluded from code (`textsOf` over all lines); the old code was never run. When memory fails to confirm at fold time, the input is re-read whole (`wholeOf`). 262 change-record and landing tests are green.
