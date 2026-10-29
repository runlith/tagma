---
id: 01a168eb-a662-7735-ab20-83d0432e534d
title: The block-file decoder reads the form the graph steps removed, or an old tree would refuse before the steps
ord: 12
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14f43-abe5-717c-8867-7b425c396d64
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/blockFile.ts
---
Graph steps translate mirror rows, and rows appear only after files are read. So the form a step removed must be accepted by the decoder: otherwise an old tree, for example a long-unopened worktree, refuses with `frontmatter-shape` before the opening reaches the steps, and every file would have to be fixed by hand.

Currently that is the form before `claims-leave`: the top-level `verifiedAt`, and on sources `fingerprint`, `probeRevision`, `verifiedAt`, plus the `check`, `node`, `date`, `url` kinds. The decoder accepts and drops them — it does to the file what the step and the `claims_removed` migration did to the rows. After the steps the projection rewrites the file into the current form. Any other extra key still refuses: then a server that does not know a newer form will not lose its data on the next projection.
