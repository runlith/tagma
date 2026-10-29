---
id: 01a1523d-ae80-7ad8-b4c0-77cfa0db1661
title: Restoring a branch thread from rollout after database loss materializes the source prefix
ord: 27
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fc-567a-72f4-83ce-3134e2c0b824",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09e500898729
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
---
After [[d7c40fd9]] a branch keeps only its own tail from position `through + 1` in its rollout, and reads the prefix through `thread_base` layers from the source rows. Importing rollout files into an empty database (`replayThreadRollout`) restores the branch with no prefix: positions `1..through` are missing, layers are missing. The rollout meta needs to carry the branch layers, and import needs to fold the source events from their files in the same project folder (positions `(after, through]` of each layer) before the tail and fold everything the ordinary way — `TranscriptFold` already understands `branched`. A source deleted before database loss leaves the branch with materialized rows in SQL but not in the file: importing such a branch must also get the prefix — e.g. by rewriting the branch rollout at materialization.

Proof: an itest — a branch and a source, database deletion, import from the rollout folder, the branch feed and events equal the former ones.
