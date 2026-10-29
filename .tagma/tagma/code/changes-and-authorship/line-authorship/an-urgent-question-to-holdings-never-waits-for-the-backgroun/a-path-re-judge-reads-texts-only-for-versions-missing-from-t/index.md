---
id: 01a14c4e-7d20-7f6a-b9ef-01d8687ec37e
title: A path re-judge reads texts only for versions missing from the fold memory
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/inputs.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/memory.ts
---
A re-judged path reads texts only for versions missing from the fold memory.

`prepareAt` → `assembled` → `textsOf` in `holdings/inputs.ts` read the full before and after texts of every standing line of a path from `workspace_change_content`, and `hunksOf` reads the hunks of all those lines. Only then does `cachedOf` in `holdings/judge.ts` compare the fold memory (`lines/memory.ts`) against the line prefix. A fold with full state in memory skips the lines already present in its record and appends only new ones (`lines/fold.ts#foldWork`), so it never needs the old versions' texts. The re-judge cost grows with the path's history: a file an agent edited 50 times re-reads up to 100 full texts on every re-judge. In one measurement such a request took 5.2 s.

## Decision

- **Compare before reading.** The fold memory is compared before texts are read, against probe metadata: line ids, before and after digests, the base digest, and the line-ending normalization marker. When the memory holds full state whose lines are a prefix of the probe's lines, texts and hunks are read only for lines past the prefix. Prefix lines enter the fold input as digests alone: the fold skips them.
- **No match — the old cost.** Without state, with state evicted by `foldMemoryBudget`, or with a diverged prefix, everything is read as now. That is not a refusal.
- **Operator splice.** The operator's glued record ([[eefb0e60]]) keeps the line id and changes its after digest. The prefix breaks before it, and it is re-read.
- **Visible cost.** `Holdings.inputs` carries the count of version texts read as a span attribute, so the cost is visible in telemetry rather than only in a bench.

## Acceptance

- bench: after one new edit, a path with 10 and with 200 standing versions re-judges in the same order of time and reads texts of no more than two versions.
- Holdings itests — fold, operator splice, evicted memory — are green.
