---
id: 01a16e42-77df-7d38-9735-e68782f01d06
title: Cheapen the remaining composition execution-host integration tests
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc54-7953-ba9c-9dd1e8cd9919",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
26 composition/testing files outside the agreed x-exec-b part dissected: five changed or merged, 21 left as standalone boundary checks. Repeated native subjects in logicSwap/logicReturn and a separate streaming server removed; managed stdout/stderr, exit3 and Completed use the shared host, UTF-8 crosses exactly one admission boundary, the retention fixture cut to the regular 4KiB. Changed checks passed seeds 1/2/3 separately with parallel=1; typecheck passed. Ledger: x10/x-harness-host.tsv. Baseline of 26 files 24.2 CPU s; for changed ones 12.9 CPU s → 14.3 CPU s in cold standalone samples with repeated world builds under load; these conditions are incomparable with the source shared run, no speedup factor established. After of 21 unchanged files not measured; the final quiet total belongs to the shared work.
