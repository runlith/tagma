---
id: 01a1957b-3bed-7d31-8e61-2156fec7a46b
title: A linked worktree removed with git worktree remove stays watched, and its owed re-measure stays journaled for every next start
ord: 1225
tags: ["reflection"]
fields:
  {
    "actual": "serve.log polls HEAD of the missing folder every minute (\"HEAD could not be read; observation will recover\"), and 7901809e/8e15721e re-measure fails 3 times and the landing \"stays journaled for the next start\", where the folder is still gone.",
    "command": "core-pin app tick: git worktree add ~/.tagma-dev/app-data/core-pin/work (a linked worktree of runlith, project 42), git commit there through the repository's hooks, then git worktree remove",
    "expected": "Once the linked worktree is gone, the server stops observing it and drops or settles the re-measure its commit owed."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

Seen 2026-11-01 05:55–06:00 local in ~/.tagma-dev/serve.log (pid 18904). The landing key is `42\0/Users/teunlao/.tagma-dev/app-data/core-pin/work\0b906aea3db…`. The commit b906aea itself stays reachable from runlith's object store, so its tree could still be measured from the main checkout; only the folder is gone. The tick runs every hour and makes a new worktree each time, so the watched set and the journal grow by one per tick.