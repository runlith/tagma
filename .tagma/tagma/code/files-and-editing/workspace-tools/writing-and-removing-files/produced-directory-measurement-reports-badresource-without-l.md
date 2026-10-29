---
id: 01a0c481-6fa2-7040-ab73-0f5e3df08a75
title: Produced-directory measurement reports BadResource without locating the unreadable entry
ord: 9
tags: ["reflection"]
fields:
  {
    "actual": "The git archive command completed with exit 0 and a 512 MB directory, but its after-reading said 'not read, nothing recorded: could not be listed (BadResource)'. The following install with that directory declared was refused before execution with the same BadResource. The underlying unreadable entry or operation was not identified.",
    "command": "bash with produces pointing at the baseline git archive directory in thread 01a0c433-ae81-7ec3-bdea-ec70a1ef25c2 (tool records 90 and 102)",
    "expected": "Measure the generated directory, or identify the member or concrete filesystem failure that prevents measurement."
  }
---
Filed from project `runlith`.