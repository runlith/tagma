---
id: 01a14128-56ed-7f74-b96f-915450f3baec
title: "The project check program starts from the shared working tree: a teammate's unfinished edit in its code or dependencies fails other landings' judgment"
ord: 44
tags: ["task"]
fields:
  {
    "holder": "tagma:01a168d1-1a32-75bb-a9ce-bfb788311076",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1404e-36da-7e13-9f27-f758664d80e9
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/checker.ts
---
`enforcement/programs/checker.ts` starts the Tagma runner with the program module from `tagma.config.ts` (in runlith — `checks/law/programs.ts`) and `cwd` at the checkout root, so the program loads its code and workspace packages (`@runlith/code-facts` and others) from the working tree, where all sessions' uncommitted lines stand. The judged tree is the landing's git tree. When a teammate is mid-way through renaming an export, the program fails on import, and all program-bound rules (8 in the reflection) refuse any landing and check_rules with `inspection-failed`, even though their change doesn't touch it.

What to decide: which revision the program starts from (HEAD, the judged tree, or the working tree as today) and how workspace packages linked by `node_modules` symlinks into working directories resolve then. Affected: the session's own change to program code must be judged by the program the operator takes as current.

Done when a teammate's unfinished edit in program code or its dependencies no longer fails the judgment of a landing that doesn't touch them — shown by an itest with two sessions.
