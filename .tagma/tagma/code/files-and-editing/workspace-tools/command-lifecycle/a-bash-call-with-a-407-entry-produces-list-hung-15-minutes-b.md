---
id: 01a0dbac-14e8-7aff-a0c7-0c2684694b75
title: A bash call with a 407-entry `produces` list hung 15 minutes before its command started, past the project's one-minute command rule
ord: 20
tags: ["reflection"]
fields:
  {
    "actual": "The call sat 15 m 34 s in \"Running\" until the operator stopped it; the command itself never ran (no file changed, the script's outputs are absent). The one-minute rule did not cut the call, so the time went to the host's handling of `produces`, outside the process the rule bounds.",
    "command": "bash `bun codemod.ts apply …` (a 4-second script) with `produces` naming 407 paths, many of them whole package directories that contain node_modules (e.g. `apps/tagma/server`, `packages/layer`), in the shared runlith checkout; command rule d88b38f2 bounds every call at 1 min",
    "expected": "The declaration is taken in well under a second, the command runs, and the whole call — declaration included — ends within the one-minute rule or is cut at it."
  }
---
Filed from project `runlith`.

Likely cost: the declaration walks or snapshots everything under each named directory, node_modules included. Whatever the cause, the call-level time bound must cover the whole call, not only the spawned process.