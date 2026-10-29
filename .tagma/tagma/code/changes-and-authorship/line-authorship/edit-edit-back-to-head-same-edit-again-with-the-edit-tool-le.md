---
id: 01a12c9a-b175-7a1b-9005-74f63163cb5a
title: Edit → edit back to HEAD → same edit again with the edit tool leaves the final line as nobody's, though the session's row stays held
ord: 88
tags: ["reflection"]
fields:
  {
    "actual": "read_changes path answers \"modified · nobody +1/−1 (written outside the record)\"; bare read_changes omits the path from the session's held paths, while its turns still list carriers.ts as held for that run. git diff shows the session's change. Cost: the session's own line can only land with whole, as nobody's bytes.",
    "command": "edit apps/tagma/server/src/change-record/prepared/carriers.ts (A→B), edit (B→A, back to HEAD text), edit (A→B) in one session within ~2 minutes; then read_changes path=carriers.ts",
    "expected": "The judgement names this session as the holder of the one changed line (+1/−1), as for every other file the session edited with the edit tool"
  }
---
Filed from project `runlith`.

Thread 01a12c86-94f7-747f-9d9d-8b4c7b522a9e, checkout /opt/workspaces/runlith, 2026-10-11 ~22:00 local. The middle edit returned the file to HEAD's bytes (a deliberate red check of a test); retirement withdraws a row returned to HEAD as `reverted`, so a likely cause is the fold losing the base for the next row on the path once the earlier rows ended. Not reproduced in a test.