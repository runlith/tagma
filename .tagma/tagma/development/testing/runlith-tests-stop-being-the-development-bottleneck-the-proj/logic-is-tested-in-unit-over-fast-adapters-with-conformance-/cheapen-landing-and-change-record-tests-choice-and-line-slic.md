---
id: 01a16dee-7e12-79f4-a79c-2089ed141fec
title: "Cheapen landing and change-record tests: choice and line-slicing logic to unit, git cheaper at the producer"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a94-8d3a-7610-abd9-8503665bc41f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Landing-tests dissection package (`landing.tsv`, x10): landing and change-record; from 14:10Z change-record went to x-graph, the landing part stays here (`composition/testing/landing/**` and the landing module). Ledger — `x10/x-landing.tsv` in the orchestrator's scratch.

Landing-part total: 284.8 → 160.8 s CPU (1.77x), one run per file under load (load average ~20 on 12 cores) — an incorporates, not a quiet measurement. Four itest files deleted: their logic moved to unit tests of fold, fold.contract and message, and link-check files merged into one. Shared cuts at the producer and in fixtures: one walk-worker pool per test rigs of Holdings, prepared functions judge the landing's own Holdings, the judge reads the HEAD tree once per revision, lease release judges only deferred paths, no repeated check-ignore, `readPaths` splits a refused batch in half, the commandWorld scenario waits for command-line writes. The remainder is real git on landing (~40 processes) in end-to-end door files; a separate task continues it.
