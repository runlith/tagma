---
id: 01a0e569-e657-7a41-8db7-ee353babd367
title: "Package wave: code-facts"
ord: 49
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
The `code-facts` card of section 7 part 2 ([[e4a0488f]]), with its vocabulary amendment [[1deb33b8]]. Owns this package's `modules` and `names` debt. Its order and waits-on edges follow section 6 ([[be799808]]) and are added with the package groups' schedule.

Wave result: `./languages` gained its browser/node export conditions. `src/floors.ts` → `src/layers.ts` and its consumer renames are deferred to the merge, alongside `enforce_rule` updates to [[39817e41]] and [[925aed1c]]: both gated rules enumerate `floors.ts` in main's checkout, so changing their reach in this worktree would break main before merge. Package-boundary's temporary consumer stays unchanged while its own replacement is underway.