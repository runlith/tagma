---
id: 01a1825a-e506-7718-80d2-47cac502b134
title: Editing a block in apply_batch rejects an existing unresolved handle in its body
ord: 29
tags: ["reflection"]
fields:
  {
    "actual": "The batch refuses batch-ref for the pre-existing [[$prune]] reference and rolls back all edits, blocking the unrelated replacement.",
    "command": "apply_batch project tagma, an edit of 18d06fb3 whose body already holds a literal [[$prune]]",
    "expected": "The existing body is edited without interpreting its unchanged reference as a new batch handle."
  }
---
Filed from project `tagma`.