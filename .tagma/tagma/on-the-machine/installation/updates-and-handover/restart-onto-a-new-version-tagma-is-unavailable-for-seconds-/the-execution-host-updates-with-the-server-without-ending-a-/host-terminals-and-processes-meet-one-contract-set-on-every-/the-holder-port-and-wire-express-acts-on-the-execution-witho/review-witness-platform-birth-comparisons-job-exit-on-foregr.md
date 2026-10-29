---
id: 01a128dd-b9fc-7e05-9e10-f7d14ee6f34e
title: "Review witness: platform birth comparisons, job exit on foreground reuse, and ChildLedger diagnostics"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12877-1313-746d-9a8b-c883865fed08
  - kind: implements
    to: 01a127ad-cc0d-7a03-b77a-95f17df613b0
sources:
  - kind: file
    ref: packages/execution-host/src/ProcessReader.ts
---
Fix the review4-witness findings: macOS owns the birth format and comparison with a wall interval, a wrong format answers with typed Unreadable; a foreground-birth change on the same pid proves an adopted job's exit; a ChildLedger without a native reader warns once at assembly. Evidence after ps takes witnesses in one native batch, and Pids/Terminal no longer read the whole machine; measure probe and event-loop delay before/after on one machine. The remaining check-then-kill race on macOS does not change. Owner tests and the typecheck of the host and five touched server files passed; the full server typecheck stopped at the 60 s limit with no diagnostics. Sample on macOS with agents running, probe/max loop delay in ms before→after: Pids (1 row, first cold request) 64.42/39.84→25.32/25.19; Terminal ttys001 (7 rows) 26.79/2.17→12.44/1.78; Table (738→699 rows) 173.71/16.83→86.20/18.41. After — two native batches instead of post-read per row; lower total loop delay is not proven by this sample. The experiment code and raw samples are kept in the thread scratch as witness-evidence.bench.ts, witness-evidence-before.json, and witness-evidence-after.json.
