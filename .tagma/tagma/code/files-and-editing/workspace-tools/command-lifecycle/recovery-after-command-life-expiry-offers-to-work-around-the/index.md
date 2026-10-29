---
id: 01a13f77-65aa-7855-ac9e-0c023e8e9b56
title: Recovery after command life-expiry offers to work around the binding limit
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "The command stopped correctly with SIGINT on a 3-minute life, but the recovery suggests a larger lifeMs up to 6h or a start_terminal with no life; both suggestions work around this work binding.",
    "command": "bash oxfmt and bun check with waitMs 1000 and lifeMs 180000",
    "expected": "After a binding 3-minute command-rule stop the answer suggests narrowing or splitting the check, not raising the limit and not moving a bounded check into an unlimited terminal."
  }
---
Filed from project `runlith`.
