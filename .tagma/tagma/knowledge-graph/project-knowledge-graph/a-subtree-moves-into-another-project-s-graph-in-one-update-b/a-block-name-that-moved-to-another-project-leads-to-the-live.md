---
id: 01a1795f-1e74-70d2-a560-112e65f7d3b9
title: A block name that moved to another project leads to the live block, not to a trash row
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1790d-c718-7101-b25d-b9da9c7cf162",
    "status": "done"
  }
---
A trash row with the uuid of a block living in another project of the machine intercepted the name. From inside its graph the name gave `deleted`, from a third project — `ambiguous-name`. Two paths leave such rows. First — deleting one copy of a stopped move. Second — the mirror: it trashes a block whose file left the tree when the machine pulled the block's departure before its arrival in the other project.

The fix is the name-resolution rule in `findTarget` and `crossing.elsewhere`: another project's live holder outranks a trash row. No separate fresh uuid is needed at deletion.
