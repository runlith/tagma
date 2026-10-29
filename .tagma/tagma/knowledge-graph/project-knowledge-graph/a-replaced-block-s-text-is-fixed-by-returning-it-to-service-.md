---
id: 01a18076-20d8-795f-a771-9cfffb6e9bce
title: "A replaced block's text is fixed by returning it to service: the `superseded` refusal names this way out, and `apply_batch` gains `unsupersede`"
ord: 128
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17f3c-3646-714e-be3f-64d8c117f696",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18068-6f10-7503-b29c-84331b46f390
---
A replaced block is frozen whole, and rightly so: editing the stale block instead of its replacement writes knowledge where nobody will read it. But the record itself — for example, striking something that must not stay — can only be fixed one way: return the block, fix it, and replace it again. The product says nothing of this: the `superseded` refusal offers only reading, and `unsupersede_block` is described as undoing a mistaken replacement.

What to do:
- the `superseded` refusal names a third way out: return, fix, and replace again, including in one `apply_batch`;
- `unsupersede_block` is described as returning a replaced block to service — after a mistaken replacement or to fix the record itself; the `not-superseded` refusals and the `supersedes` edge removal say the same;
- `apply_batch` gains an `unsupersede {op, id}` operation, so the three steps stand as one document and roll back together.

There will be no new operation: `edit_block` does the fixing, `unsupersede_block` the returning.
