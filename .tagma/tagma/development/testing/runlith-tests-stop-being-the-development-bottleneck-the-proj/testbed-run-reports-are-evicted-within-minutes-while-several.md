---
id: 01a17a7f-c238-7769-960e-2de0f748b586
title: testbed run reports are evicted within minutes while several agents work in parallel
ord: 51
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a17a74-ae9e-7031-af45-864eafadc5fd
sources:
  - kind: dir
    ref: packages/testbed/src/core
---
testbed keeps the last 40 JSONL files in `/tmp/runlith-test/reports/`, shared machine-wide. On 2026-10-27, while about ten agents were working on tests, testbed-handoff lost all three reports it needed during its work on [[afadc5fd]]: the original red run, the run where it reproduced the defect, and its exact repeat. Only execution output addresses remained. The report is the main evidence when dissecting a red run and when measuring, so keeping a fixed number of runs per machine does not survive ordinary parallel work. Decide what should retain a report: age, run owner, or a reference from `check:change`. Account for diskspace on machines of any size.
