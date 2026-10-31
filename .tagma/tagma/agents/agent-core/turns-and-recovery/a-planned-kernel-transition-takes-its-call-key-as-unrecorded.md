---
id: 01a19106-4806-7d69-b079-88a425d6fe7d
title: A planned kernel transition takes its call key as unrecorded and guards it; a planning failure answers a standing key first
ord: 24
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
  - kind: relates
    to: 01a13635-e91a-7a7a-94ed-26ec59b927cd
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/runs/transitionStore.ts
---
Inside a write program, a `call` evidence lookup answers `absent` from guards instead of reads: no `thread_call` row and no spent key may stand for that key at commit. A key that does stand turns the program into a conflict, and the interactive unit's own lookup then replays it, compares digests or answers spent. The program's snapshot also reads the thread version once: its commit guard already checks foldRev, inheritRev, head and `updated_at` against that version, and versions only grow.

The decision runs on the assumption that the act is new, so it may fail on state the original act left behind (for example a settlement whose entry is gone). A typed failure or defect raised while the program is being planned therefore first reads every key that program took as absent. If one stands, the program falls back to the interactive unit, so a repeated act still answers its recorded outcome instead of the new failure.