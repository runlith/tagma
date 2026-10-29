---
id: 01a14e44-02ae-7fcc-9c7c-556e933e6c07
title: finish_block refused open-children right after the child was moved to another parent
ord: 25
tags: ["reflection"]
fields:
  {
    "actual": "finish_block refused `open-children: 1f3cc08a`; read_block of e47cdfcd at depth 1 showed no children, and the same finish_block, called again, succeeded. Cost: one extra refusal and two reads.",
    "command": "update_block(1f3cc08a, parentId: 7e9130bd) then finish_block(e47cdfcd, commit: bdf33f20ad)",
    "expected": "After the move answered, e47cdfcd has no open child task and finish succeeds"
  }
---
Filed from project `runlith`.