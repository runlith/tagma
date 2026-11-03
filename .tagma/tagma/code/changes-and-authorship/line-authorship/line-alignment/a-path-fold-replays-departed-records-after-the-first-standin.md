---
id: 01a176cd-1c53-7141-a5d5-d7294267fd67
title: A path fold replays departed records after the first standing one with hunks instead of restoring them with a textual break
ord: 10
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a176b7-7ebf-7d63-ac5a-90cf76a1124d
  - kind: relates
    to: 01a1125b-d486-70e8-8045-281ec851d6c3
  - kind: relates
    to: 01a176b7-6308-7f25-851e-68a39f26b778
sources:
  - kind: file
    ref: apps/tagma/server/drizzle/20261026061338_retained_hunks/migration.sql
  - kind: symbol
    ref: apps/tagma/server/src/change-record/holdings/inputs.ts
    symbol: rowsAt
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: projectWork
  - kind: symbol
    ref: apps/tagma/server/src/change-record/record/texts.ts
    symbol: requeueTexts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/store/tables.ts
    symbol: followsStanding
---
A path fold replays departed records after the first standing one with hunks instead of restoring them with a textual break.

A path fold starts at the before of the first standing record. Records that departed after it (committed or withdrawn) used to stay out of the fold, and the fold replayed their edits as an `external` break step — a textual diff between snapshots. Among equal lines that diff picked a different line than the record itself picked: the working file's line identity diverged from both the recorded edits and a stored landing composition ([[9f26b778]]), and lines were credited to the wrong writer.

Now Holdings reads a window: the path's standing records plus departed records after the first standing one that still have a hunk. Both sides are read in one statement so the window boundary and the standing-record set come from one snapshot; the departed part is taken as a range from the window start over the departed-records partial index, not over the path's whole history. The fold replays their recorded hunks. Departed records before the first standing one are dropped: their edits already lie in the window base. A departed record stays in the window only when it can replay without assembled texts: it continues the window's previous record or its before is still stored, and a record with `reverts` additionally needs its after stored. Otherwise its edit becomes a break between neighbours again, as before the window: without that, an external break before the assembled before would leave the still-standing record's verdict unknown.

A departed record in the window never makes anyone a holder. Its lines and its deletion come out nobody's in the verdict, its writer is named in neither the unknown verdict's `writers` nor the whole-file chain, and fold links through its source are dropped: otherwise two standing edits would link transitively through an already landed one. Holdings computes `domain`, annotations and holders over standing records only.

A departed record's hunk is not collected while an earlier record on the same path still stands: triggers only queue `workspace_change_retired_text` records that no one holds behind them, and a standing record's departure queues the freed records of its path ([[c851d6c3]]). So the queue stays "collect now" work, and the collector never rewalks a blocked tail on every pass. A window is bounded by the age of the path's oldest standing record.

When a landed edit was recorded before the first standing record, its HEAD at landing never enters the window. HEAD lines a landing kept are then recognized by the fold through the record that deleted them — inside the window when it stands or departed after the first standing one ([[9f26b778]]); otherwise by textual alignment.
