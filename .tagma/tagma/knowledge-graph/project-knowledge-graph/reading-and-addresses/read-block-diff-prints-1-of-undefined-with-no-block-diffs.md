---
id: 01a150b3-2493-7068-841f-1df42e74157c
title: read_block_diff prints "1 of undefined" with no block diffs
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "The answer holds only the block name and \"1 of undefined\"; changes and a meaningful total are missing, so one call cannot read the diff.",
    "command": "read_block_diff({\"project\":\"runlith\",\"blockId\":\"78efcd89\",\"from\":256330,\"to\":256331})",
    "expected": "One read shows the block's changes between the given positions, or explicitly reports no changes or invalid positions."
  }
---
Filed from project `runlith`.
