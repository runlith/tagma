---
id: 01a16dee-cff3-7345-9a60-70d50c5d64da
title: "Cheapen the remaining server module tests: composition, platform, plugins, notify and access"
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-5b72-77e0-b64e-010b3887cd2d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Server-rest dissected: 195 unique files, 253.4 s CPU before; the repeated chain.itest.ts line counted once with a 1.5 s total. Duplicates removed, expensive scenarios merged, pace moved to unit, logic SQL cases use a shared in-process pool; real git, file, process and door boundaries preserved. All changed remaining tests are green individually on seeds 1, 2 and 3, with no skips and no raised timeouts. On 31 paths with numeric results: 128.7 s before → 88.5471 s after; these are old quiet numbers versus new single runs under load, so the 1.45 ratio proves no speedup. Full CPU after and reaching 10–20x remain unverified until the coordinator's quiet measurement at 17:30Z. All 195 outcomes and covering contracts recorded in x10/x-server-rest.tsv; no missing, extra or repeated lines. The last server typecheck named no errors from this delivery but failed on another owner's current syntax edit in journalDoor.itest.ts; the error was handed to them.
