---
id: 01a15cb0-be37-7d25-9542-0967e1c6cda1
title: "The command row shows whether it has output: the `>_` icon brightens with the first byte, the terminal appears only with output"
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15cb1-0bb1-7a79-b335-2d4c651062a6",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a15c49-6c0d-7317-893d-d54d0c39e069
---
The operator's decision: no empty terminal opens, and before pressing it is visible whether there is output — with no numbers or labels. In the thread operations popover row (`WorkLine`) and the feed command card (`CommandToolRow`) the `>_` icon is dim while the pipes program wrote nothing, and takes the row text's color from the first byte of its `output`. Expanding shows the full command, and the terminal under it only when there is output; in an already expanded row it appears on its own with the first byte.

The fact belongs to the record on the host. It reaches the window as a live read in the inventory row, next to `usage` and `processes`, with no column in the host store; on the first `output` byte the host bumps the inventory revision once so the command feed moves at once. The same fact is needed by held pipes-program rows from the terminal list.
