---
id: 01a15cbb-abdb-7ccd-8d87-43d1cea5d210
title: The terminal grid parses bytes at the size recorded at their position, and its subscription recovers on its own
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15cb6-19b7-7997-b32a-4b35f106687a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15c5c-d764-7aca-9b65-9090251c93cd
---
Found by the terminal delivery review. `ViewGrid` for the deciding view paints the measured container size and refuses to apply the record's `range.grid`, so bytes before the resize boundary in the record are parsed at the new size already, and the screen diverges from the checkpoint and the host. After two grid-subscription failures `ViewGrid` stops recovering it, keeping no state at all.
