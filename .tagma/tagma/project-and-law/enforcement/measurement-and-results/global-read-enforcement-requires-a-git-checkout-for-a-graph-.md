---
id: 01a1478d-84a2-7f61-8d43-c35c83230304
title: Global read_enforcement requires a git checkout for a graph without one
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "Refused inspection-failed: measurements at ~/.tagma-dev/global could not be read because it is not a git repository; the unblock points to a future measurement and offers no usable reading.",
    "command": "read_enforcement({\"project\":\"global\",\"limit\":100})",
    "expected": "List global rules and their enforcement without requiring a repository for the global graph."
  }
---
Filed from project `runlith`.