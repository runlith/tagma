---
id: 01a0e569-e66b-72e0-a606-f00da7da3fad
title: "Package wave: ripgrep"
ord: 51
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e816-42ad-7160-9b82-7a68c689e4cd",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-f876-7433-b54b-0ba8e4a0488f
---
The `ripgrep` card of section 7 part 2 ([[e4a0488f]]), with its vocabulary amendment [[1deb33b8]]. Owns this package's `modules` and `names` debt. Its order and waits-on edges follow section 6 ([[be799808]]) and are added with the package groups' schedule.

Wave result: no code or manifest change. The card and its amendment prescribe none; the existing Bun-only binary resolution and root entry match them, and the graph zone [[90d97bc9]] already stands. Package typecheck and both path-targeted inspections found no violations; `names` currently excludes package scope. No commit exists for this no-op.