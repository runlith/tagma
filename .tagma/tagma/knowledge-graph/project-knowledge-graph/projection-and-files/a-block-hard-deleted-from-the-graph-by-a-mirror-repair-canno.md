---
id: 01a12cad-06a8-7ae6-89b4-136c2477ffa3
title: A block hard-deleted from the graph by a mirror repair cannot be brought back with its id through any operation
ord: 18
tags: ["reflection"]
fields:
  {
    "actual": "The mirror repair removed the rows outright (removeBlock, no trash): list_trash answers 0, read_block not-found. create_block and apply_batch mint a new id. The only road is writing the old file back into `.tagma` by hand and letting the mirror absorb it, which the `.tagma`-belongs-to-the-server rule forbids without the operator's word.",
    "command": "restore 55b5437b and 97fdddaf4476 in runlith after the rename collision of 872121e7: list_trash runlith; create_block / apply_batch",
    "expected": "An operation re-births a lost block from a known version (a git revision of its file, or its frontmatter) under its original id, so references and edges to it stay whole"
  }
---
Filed from project `runlith`.

Found while answering 872121e7. Cost: the restoration stops for an operator decision on a manual `.tagma` write; a new id would break ~8 body references to 55b5437b and 3 discovered-from edges to 97fdddaf4476.