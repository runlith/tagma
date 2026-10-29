---
id: 01a12c91-8bbe-712a-bd7d-2c59f8adb447
title: grep ends again with a gap on stdout
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Repeating the exact call in this session returned [grep] error: BadResource: executionSpawner.stdout: the record stopped answering: gap again; no results and no execution ref returned. The address-diagnosing code is already being fixed, but the stdout loss still reproduces.",
    "command": "grep({pattern:\"tagma\",path:\"/opt/workspaces/runlith/packages/\",limit:60})",
    "expected": "A page of matches or a bounded answer with an address."
  }
---
Filed from project `runlith`.
