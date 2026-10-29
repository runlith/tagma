---
id: 01a129c1-180a-7f60-b26a-6e5615a60103
title: submit_work names clean or already-deleted paths as lines still standing uncommitted
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "left lists db/persisted.ts and registry/departure.ts (git status clean after the commit) and long-deleted files src/departure.itest.ts, src/testing/departingLogic.ts, drizzle/20261011064726_* as still standing uncommitted",
    "command": "submit_work(paths=[…18 paths…]) → landed 925169017f",
    "expected": "left lists only paths where this session's lines still differ from HEAD"
  }
---
Filed from project `runlith`.