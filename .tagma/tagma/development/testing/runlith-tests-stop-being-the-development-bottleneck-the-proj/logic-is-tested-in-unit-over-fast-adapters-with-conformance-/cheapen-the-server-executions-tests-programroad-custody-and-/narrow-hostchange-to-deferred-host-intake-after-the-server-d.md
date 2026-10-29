---
id: 01a16df0-8a03-7cf6-a6f4-525c1a523e6a
title: Narrow hostChange to deferred host intake after the server door
ord: 2
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
HostChange builds three executions layers instead of three full runtimes; one workspace and two ready bundles kept per scenario. It checks unchanged host/manifest/migrations until takenAfter, waiting for start and both reads, migration and continuous output after opening, read release after failure. Native handover/input/recovery duplicates are covered by execution-host conformance. The file passed seeds 1/2/3, 1 test and 16 assertions. Source 16.2 s CPU → 9.5 s in a separate run under load, of which 5.9 s is the world; this is not the set's quiet total.
