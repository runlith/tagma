---
id: 01a13644-2f09-7311-9f27-560144b22409
title: A peer's staged deletion during this session's command is credited to this session as its own uncommitted lines
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "read_changes lists it under this session as `deleted · +0/−193 · writing`, and submit_work answers \"lines of this session still stand uncommitted\" for it after landing 354eb69fe4. The session never touched the file; it had to be left out of `paths` by hand.",
    "command": "bash `bun .cache/maps-check.ts` (apps/tagma/desktop), then read_changes and submit_work in /opt/workspaces/runlith",
    "expected": "packages/execution-host/src/NativeUsage.stest.ts, deleted and staged (`D ` in the index) by another session, stays that session's or nobody's"
  }
---
Filed from project `runlith`.