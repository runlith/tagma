---
id: 01a1125c-56c2-770f-a620-535a3ced09e1
title: "Committed edits' inline texts grow with history: landing never clears them, discharge does"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11240-8e4d-73c7-bcd8-d90d8bc83db1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a111ab-9639-7730-81d5-59311ee0244c
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/stamping.ts
---
Committed edits' `workspace_change` lines keep their inline texts (`old_text`/`new_text`) forever when a landing committed them: `stampCarried` from `submit_work` never touches them, and only `dischargeCarried` calls `clearTexts` — for lines proven on HEAD. On 2026-10-06 (read without write) committed lines' inline texts occupy 339 MB of 840 MB of all inline texts, and the `workspace_change` table is 970 MB on disk with 25,497 uncommitted lines out of 205,767.

After the [[1ee0244c|version collection]], one consumer reads a committed line's inline hunk — turn rollback (`lines/revert.ts`) for the `committed[].counts` counters in `read_rewind`; without the hunk the counter falls back to `lines` and `removed: null`.

Decide whether anyone else needs committed lines' texts, and bring landing and discharge to one rule. Done when committed lines' inline texts no longer grow with edit history, or the reason to keep them is named in code and the graph.
