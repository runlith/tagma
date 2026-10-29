---
id: 01a18068-6f10-7503-b29c-84331b46f390
title: A replaced block with confidential text can be neither cleared nor moved to another graph
ord: 170
tags: ["reflection"]
fields:
  {
    "actual": "edit_block 439f444e (superseded by 44f7f1c3) refuses with refused[superseded] and offers only read_block; the move refuses with refused[relocation-shape] because the supersedes edge must live in one graph. The only way left is to lift the replacement (unsupersede_block), edit, and replace again — three acts per block, against the point of unsupersede",
    "command": "edit_block 439f444e (superseded by 44f7f1c3), cutting a private package name from the body; then update_block 439f444e parentId=42/6fde22be",
    "expected": "There is one door that removes from the current text of a replaced block what must not be published (a private package name, a secret), or moves the block to a private graph while keeping the replacement history"
  }
---
Filed from project `tagma`.

Met while preparing the `tagma` graph for publication: three replaced drafts (7396c177, 4c09d51e, 439f444e) carried a private package name, while their replacements were already cleaned. For any user this is the same case as a secret mistakenly written into a block that was later replaced: the replacement history must stay, the text must not. Worked around by lifting the replacement, editing, and replacing again.
