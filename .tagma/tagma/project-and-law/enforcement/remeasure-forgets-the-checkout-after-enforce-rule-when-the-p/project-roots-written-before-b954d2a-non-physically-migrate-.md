---
id: 01a1695e-3fa2-7b0a-9df2-3d4e1c341830
title: Project roots written before b954d2a non-physically migrate together with the stealth tree, mirror and coverage record
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a16920-ce52-7433-add7-f4f9371cd107
---
Since b954d2a4d1 a new project without git (or a repository before its first commit) records a physical root. Registry rows written earlier via `/tmp/x` or through a symlink stayed as they were: for such projects remeasure after `enforce_rule` and restart still loses the checkout ([[78f606d3]]).

Plain root rewriting at start was rejected by review: storage paths hash the root spelling, so the graph history and the mirror trash are lost, and the coverage record stays under the old spelling and answers `moved`. What is needed is a migration carrying the root, the stealth tree, the mirror (journal and trash) and the coverage record in one step. No such rows found on the operator's machine — work for other users' machines.
