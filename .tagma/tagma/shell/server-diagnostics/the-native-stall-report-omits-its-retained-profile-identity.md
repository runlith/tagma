---
id: 01a0f3bc-bc82-780f-875d-6821319cfbc6
title: The native stall report omits its retained profile identity
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "The native text named the stall, frame, callers, overlap and vital count but omitted profileId and wallTime. The same public operation over the CLI returned profileId eff01a6d-35bc-404c-a443-0b165b1df67a and wallTime 1790720807676; profile-list searches before that returned several adjacent captures.",
    "command": "read_performance({type:\"stall\",id:\"22aef1c1-9f59-40ce-bbbb-8925db1ef121\",limit:3})",
    "expected": "The explained stall names its associated profileId so the next profile read can address the retained capture directly."
  }
---
Filed from project `runlith`.

The underlying report already carries the navigation; the native performance-report renderer loses it. Locating the old event-fold capture required two stall pages, three profile-list pages and nine adjacent profile reads before reading the JSON operation result.