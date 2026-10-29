---
id: 01a18567-29fd-7492-b0bf-f4507f2f5622
title: A child resting on its own background command hands its held task to the parent, and back on each wake
ord: 140
tags: ["reflection"]
fields:
  {
    "actual": "each such rest passes the held task to the parent (\"stopped working and held a task; it is yours now\"), the parent must message the child to re-claim, and the next rest hands it over again",
    "command": "child agent ends its turn while waiting for its own background test run (bash waitMs passed), as the agent loop instructs",
    "expected": "the child stays the holder of the task it claimed: it has not stopped working, its run will wake on the command's notice"
  }
---
Filed from project `tagma`.

Seen 2026-10-29 with browser-record (01a18547-c530-7893-af7a-adb0a9d1893c) on task 4125340a: rested waiting for a seed-3 rerun notice → task passed to the parent; re-claimed on wake; rested again waiting for the full seed-3 output → passed to the parent again. Same with browser-presence (73c47652) and pick-source earlier. The hand-over is meant for a child that stopped working; a rest awaiting the child's own live command, which the system prompt requires instead of stalling the turn, is not that.