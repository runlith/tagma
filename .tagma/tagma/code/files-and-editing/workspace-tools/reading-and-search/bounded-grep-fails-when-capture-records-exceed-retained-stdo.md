---
id: 01a132d8-4405-71fa-b0a5-0530b85b0723
title: Bounded grep fails when capture records exceed retained stdout
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "Returned [grep] error: BadResource: executionSpawner.stdout: execution acf4bd8f-b132-4540-abe1-06b8628cadbd:163 stdout: output exceeded the retained record; read the retained bytes under this execution reference. No matches or cursor were returned.",
    "command": "grep({pattern:\"claude-cli/|9d1c250a\",path:\"/opt/workspaces/runlith/packages\",include:\"*.{ts,json,md}\",limit:150})",
    "expected": "Return at most 150 bounded matches and a continuation cursor."
  }
---
Filed from project `runlith`.