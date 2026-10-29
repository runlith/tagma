---
id: 01a1802d-549a-7d3b-a1ab-6199fefc41cd
title: apply_batch link rejects a target in another project, although link_blocks accepts it
ord: 178
tags: ["reflection"]
fields:
  {
    "actual": "With the address — bad-document: toId must match ^(?:\\$\\S+|[0-9a-fA-F]{8,32})$; with the bare name — not-found 'no block is named ef68cb54' in project 30. The same act through link_blocks passed: ok",
    "command": "apply_batch project=30 ops=[{op:\"link\", fromId:\"a46b6e95\", kind:\"relates\", toId:\"42/ef68cb54\"}] (and the same call with toId:\"ef68cb54\")",
    "expected": "A relates edge to the project-42 block is created, as link_blocks fromId=30/a46b6e95 toId=42/ef68cb54 creates it"
  }
---
Filed from project `tagma`.

The batch schema for operation reference fields (`toId` on link and probably `id`/`fromId`) takes only the bare name or `$handle` and looks it up in the document's project, while single doors accept a `blockMention` with `<project>/<name>` and find the block in another project. A cross-project edge therefore cannot be made in a batch, and the refusal's way out (`search_blocks`) does not lead to it.
