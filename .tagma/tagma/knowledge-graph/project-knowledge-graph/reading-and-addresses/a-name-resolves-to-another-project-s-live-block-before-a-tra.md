---
id: 01a1795f-a979-759b-a8a0-6399a4b76617
title: A name resolves to another project's live block before a trash row; copies of the same project take no part in this
ord: 6
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a11b65-f219-70d5-8e2c-66aac7c0b002
  - kind: relates
    to: 01a1410d-c9d2-795d-a7f8-9eabc82c927b
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/crossing.ts
    symbol: elsewhere
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/crossing.ts
    symbol: findTarget
---
A block may move to another project's graph. Then the row with its uuid stays in the trash of the graph that learned about the departure earlier than the arrival. That happens after deleting one copy of a stopped move. It also happens on a machine that pulled the source project before the target: the mirror puts a block whose file left the tree into trash, keeps its uuid so a returned file revives the same row. At the moment the row lands in trash, the other project does not hold this block yet. So the rule stands at name resolution, not at whoever puts the row into trash: a fresh uuid on deletion was rejected — it would not have closed the mirror path.

Without the rule, a name from inside the old graph gave `deleted`, and from a third project — `ambiguous-name`, although the block is live in exactly one place.

Copies of the same project — the main checkout and worktrees — do not count as a live holder against its own trash: a block deleted on a branch stays deleted for that branch. The `<project>/<name>` address leads to the named project's row, including a trash row. So `restore_block` lifts the copy from trash when the block lives in another project; a bare name in this case refuses with this exit. Two live holders in different projects are still `ambiguous-name`.

Cost: other projects are asked only when the own name is found in trash — one question to the machine copy index. Fresh uuids on trash rows stay where the one-storage uuid unique index requires them: on subtree departure and on arrival.
