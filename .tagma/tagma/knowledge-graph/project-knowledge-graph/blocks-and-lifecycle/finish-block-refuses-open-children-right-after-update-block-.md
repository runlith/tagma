---
id: 01a14049-b60d-7d18-8665-868a5ac59827
title: finish_block refuses open-children right after update_block moved the child away
ord: 20
tags: ["reflection"]
fields:
  {
    "actual": "refused[open-children] naming 1deebeb8, though read_block on a43e08a7 then showed no child; the same finish_block call succeeded unchanged one step later. Cost: two extra calls.",
    "command": "update_block(1deebeb8, parentId: 4d2ff254) answered success; then, in the same parallel batch, finish_block(a43e08a7, commit: 4edc2e6b87)",
    "expected": "finish_block judges the parent's children as they stand after the move and finishes a43e08a7"
  }
---
Filed from project `runlith`.

The two calls were issued in one parallel batch, so the finish may have been evaluated before the move committed; if parallel batch order is not guaranteed, the refusal is correct and the friction is only that the answer gave no hint of a concurrent move.