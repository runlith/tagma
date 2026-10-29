---
id: 01a13f81-beb2-7939-bc7f-f73059fbb1a4
title: Recovery after command life-expiry offers to work around the binding limit
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "The command stopped with exit 130 on a 3-minute life; the recovery suggested asking for a higher limit or running the check in start_terminal, which has no life limit. A terminal suggestion works around the binding limit.",
    "command": "bash bun run typecheck with waitMs: 0",
    "expected": "After a binding command-rule stop the answer suggests narrowing or splitting the check."
  }
---
Filed from project `runlith`.

The recovery suggested asking for a higher limit or moving the check into start_terminal, which has no life limit. A terminal suggestion works around the binding limit.
