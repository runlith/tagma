---
id: 01a16dee-7e96-7a4b-9b50-cf8df1166c41
title: "Cheapen the server executions tests: programRoad, custody and host scenarios"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-2b0b-7892-afdb-3123a319f97d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
105 files dissected with 233 s CPU source cost: 12 deleted (86 s of source CPU), lane lifecycle moved to unit, two native scenarios narrowed, 13 SQL fixtures moved to a shared in-process pool. Unique input attribution checked through Terminals.input/typedBy; shared managed-world smoke and an uncalled helper choice removed with accepted loss of end-to-end coverage. Changed kept files passed seeds 1/2/3 separately. All outcomes and commits recorded in x10/x-exec-a.tsv at the starting agent. Sum of separate runs under load for 29 known outcomes is 178.6 → 65.2 s CPU (2.74x), with repeated cold setup; this measurement does not establish a full after or reaching 10–20x. The total is the shared quiet run at 17:30Z; no Docker checks ran here.
