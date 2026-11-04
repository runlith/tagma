---
id: 01a14c18-c833-7d88-b3bd-66ec88ce8e39
title: Finish the executions Effect migration and its composition tests
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae5-73b8-9762-d6fecee64610",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
  - kind: relates
    to: 01a13d06-539b-7fa6-b738-157a93e5aa01
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/executions
  - kind: dir
    ref: apps/tagma/server/src/executions
  - kind: file
    ref: packages/execution-host/native/holder/src/posix/output.rs
---
The Effect migration of apps/tagma/server/src/executions and composition/testing/executions is finished, including the [[93e5aa01|HostFloor analysis]], scoped fixtures and directly linked harness consumers; the packages' main migration stays a separate job. Current checker: 266 files, 0 violations, unjudged []; full targeted typecheck — 3657 files with no errors, later changes verified with narrow slices, including benchmark and native holder tests. Wire and previous spans preserved. The single Sol xhigh review is worked through: its P2 was removed at the native writer, the live log is capped at 16 KiB, the lease keeps the active file, the next placement removes finished attempts; a public test showed red 262162 B and green within 16384 B. Final boot.itest — 11/11, candidate.itest — 5/5, hostBoot.stest — 7/7 in 18.52 s, other contract checks are in the delivery report. Not proven: the full run of process-heavy system files, all 16 wholePath scenarios and load benchmarks — some scenarios need fan-out above three; a separate wholePath input-and-readback scenario was run. The early automatic result was fully re-read and hand-audited, further migration is manual.
