---
id: 01a15a9e-c55b-78cf-8ee7-8424cc9a50ac
title: A block with the same id in two projects is addressed with project at every door, and `ambiguous-name` tells candidates apart by project
ord: 223
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15a9e-e8f4-7e76-bab5-f651d6c30fe9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15a9c-2d4e-7e70-910f-e6651cabb6bb
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/ambiguity.ts
---
A repository clone or fork registered as a separate project carries a graph copy with the same block ids. `enforce_rule {blockId: "18ad9402", …}` from a runlith thread with the rule in law-lab (39) and its copy in lab (40) refused `ambiguous-name` with two identical `876818ad9402` candidates. The `project` door did not take (`body-shape`), and `read_enforcement` with `project: law-lab` answers. No way out.

Do: find where the door resolves a block name into a project and fix there, at the producer, for every door addressing a block: each takes `project` (as `read_block`/`read_enforcement` do), and `ambiguous-name` candidates and their `unblock` name the project so the way out is workable. The same defect at `check_law` is [[7769efcd]]; answer it too, and [[1cabb6bb]].

Proof: a test through a public operation — two projects with one block id, a call with `project` lands in the right one, with no call the refusal names distinguishable candidates; landed commit.
