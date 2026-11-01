---
id: 01a194d4-5d31-7d2c-9a7e-0fea1744155d
title: Holdings witnesses stay serialized until the worker applies them
ord: 13
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a19487-1565-7388-9082-e7b9e6850f6b
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/evidence.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/debts.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/released.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/landed.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/witnesses.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/verdicts.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/record/runFiles.ts
---
Mapping witness JSON into arrays in the serving process would reconstruct whole-file step windows, released spans and landing compositions before the fold starts. Court therefore reads their serialized payloads, derives freshness keys from scalar record data and cardinality, and decodes them after shared-buffer transfer. The worker applies the complete evidence and reduces line reasons and per-record counts before replying; Holdings and rollback consume those summaries without expanding every lazy verdict line. The decoded debt read remains a separate projection of the same stored-row owner for callers that need its windows.