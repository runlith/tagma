---
id: 01a19486-da23-7dc0-a751-a492e1adeb17
title: After a checks/law edit, landing names one unprepared program index per attempt instead of every one it needs
ord: 174
tags: ["reflection"]
fields:
  {
    "actual": "Each attempt fails all 15 program-backed gated rules on the first missing index only (dead-code, then vendor-ids, then ask-calls); every round costs a full submit_work or check_rules run of 1-2 min",
    "command": "submit_work (subject \"feat(app-wire): take codecs, live group and operation types from the build's catalog\", tasks [f0c456d5]) after editing checks/law/declarations/read.ts",
    "expected": "One refusal names every program inspection (dead-code, vendor-ids, ask-calls, …) whose revision index the changed reader lacks, or the gate prepares them itself, so one preparation round lands the change"
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T23:25:28.662Z, from 3a395b0b3.

Editing any file under `checks/law` changes the reader version, so every program index has to be built again for that version. `checks/law/programs.ts` runs the inspections in order, and the first `ensure` that throws ("run check_rules with inspection X over change … to prepare the candidate") aborts the whole program, so the 14 other rules report the same failure text. The refusal's unblock is followed correctly each round and still fails on the next index.