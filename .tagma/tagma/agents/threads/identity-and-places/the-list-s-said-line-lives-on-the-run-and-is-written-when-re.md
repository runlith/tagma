---
id: 01a12750-bbcf-74d4-8c6c-92ffdea260f6
title: The list's "said" line lives on the run and is written when records are placed
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/said.ts
---
Each run has two lines:
- `thread_run.said_live` — what a running run shows;
- `said_final` — what a finished one shows.

Both are derived by one `threads/list/said.ts` expression from that run's `thread_entry`. Fold calls it when placing records (`native-harness/transcript/rows.ts`, decides `movesSaid`): an appended record changes the line only when it is a non-empty assistant text; inserting at the start, replacing and deleting a `message` or `tool` always recompute. Without this a series of tool calls would recompute the run on every record — quadratically in run length. The list only picks the needed column by run state and never reads journal bodies, so the line survives offload.

A computed empty line is stored as `''`, while `null` means "not computed"; the list reads `''` as no line.

Threads that lay in SQL before the columns appeared are filled by a one-time pass after `Maintenance.opened` (`threads/list/saidFill.ts`): `unsaidThreads` picks unarchived, non-offloaded threads whose shown run is still `null`, and `saidOfShown` updates only the running run and the last finished one. There is no "all runs" call, because it would cost as much as the thread's whole journal. The pass is transitional code and leaves with the next folding of the base migration.
