---
id: 01a1851c-1e9c-7089-875e-6f7ce8976414
title: Moving a block assigns a different parent from the requested block
ord: 248
tags: ["reflection"]
fields:
  {
    "actual": "The call reported the reflection under 52435a17, an unrelated completed task; a subsequent read confirmed that parent.",
    "command": "update_block({blockId: \"cbf63b6f\", parentId: \"feef9784\"})",
    "expected": "Move the reflection under the test stand module feef9784."
  }
---
Filed from project `tagma`.

Both the requested module and the unrelated parent were readable immediately after the move. The intended graph move remains unfulfilled.