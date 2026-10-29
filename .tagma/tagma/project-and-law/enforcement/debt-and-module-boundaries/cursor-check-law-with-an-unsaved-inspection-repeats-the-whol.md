---
id: 01a14e45-75d0-7dd9-8bbd-1bdf5793cc45
title: Cursor check_law with an unsaved inspection repeats the whole allowances config and pushes the check outcome out
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "Cursor holds the base64 of the whole unsaved inspection with hundreds of allowances. Output exceeded 50 KB; the bash answer started mid-cursor, pushing out the generator summary and the result start.",
    "command": "tagma op check_law on the swallowed-sites preview JSON with --json.",
    "expected": "With limit=10 get a bounded result page; the continuation must not return the whole large inspection config in the cursor text."
  }
---
Filed from project `runlith`.

The check used the standard JSON-file input. The config held 237 exact allowances after remap; limit=10 capped violations, but the cursor carried the whole input in every answer.
