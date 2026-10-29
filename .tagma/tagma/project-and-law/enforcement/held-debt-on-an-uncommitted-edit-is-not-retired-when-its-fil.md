---
id: 01a16183-c7b4-7395-90cb-d65d0344810b
title: Held debt on an uncommitted edit is not retired when its file is deleted before landing in a commit
ord: 112
tags: ["reflection"]
fields:
  {
    "actual": "read_enforcement 50520d64 keeps 2 debt entries on this path (debt 4 instead of 2) for task a2bfd956 after remeasurement",
    "command": "enforce_rule 50520d64 absorb [fingerprints in packages/tagma/src/rules/declarations.ts] (held debt), then the file was moved to packages/tagma/kit/ and deleted before landing; remeasurement 2026-10-22T02:47:28 on 5d387ebde4",
    "expected": "held debt on packages/tagma/src/rules/declarations.ts is retired: the file is in neither HEAD, nor history, nor the working tree (“retires once its file changes without it”)"
  }
---
Filed from project `runlith`.

`git log --all -- packages/tagma/src/rules/declarations.ts` is empty, `ls` has no file. The entries were taken by the inspection-signatures agent (thread 01a16152-e4e7-7e5c-8806-44c20dabcee1) on the intermediate path, which then moved the compiler to kit.
