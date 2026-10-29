---
id: 01a16def-ab9d-74f7-8d71-ea263e33a5a0
title: Cheapen execution custody and view lanes without repeating host contracts
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-2b0b-7892-afdb-3123a319f97d",
    "status": "done"
  }
---
Five source files cost 38.6 s CPU. activationCustody, threadDeleteDisown and viewLanes duplicates removed; unique input attribution moved into public Terminals.input/typedBy over SQLite and the host double; lane lifecycle checked resourcelessly through TerminalLanes and the real grantBook with TestClock; native held-stdin keeps the admission matrix, record and stream end, refusal to a substituted pipe handle in one scenario. Separate measurements under load: laneCustody 6.9 s CPU, laneGrace 0.6 s; the other three files — 0. Changed kept files passed seeds 1/2/3; the set total needs a quiet measurement since HostBundle and SQLite are shared across files.
