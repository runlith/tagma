---
id: 01a1325a-f6c6-7dc6-be93-55d788f57477
title: Landing drops the pick after carrier commands' lines record and repeats until their revision stops changing
ord: 5
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/prepared/change.ts
    symbol: prepareChange
---
Carrier-command lines write through a queue after their end, so a path snapshot taken before the write never saw the just-ended command: the named path answered `unmatched`, and a bare landing answered `nothing`, while the lines landed milliseconds later. `CommandChanges.decided` answers with a revision — how many of the session's commands are already queued for recording — and waits for their writes; landing drops the pick, waits for its paths' lines, and picks again, until the carriers' revision stops changing (at most three snapshots: a carrier still writing hands back the latest snapshot). Waiting for foreign commands' lines runs over the pick's paths, not the whole checkout: someone else's big command never delays a landing that never touches its paths.
