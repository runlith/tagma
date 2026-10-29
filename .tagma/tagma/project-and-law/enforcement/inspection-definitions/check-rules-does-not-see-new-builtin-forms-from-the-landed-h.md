---
id: 01a116e0-5bba-787e-8220-cf400da4b4f7
title: check_rules does not see new builtin forms from the landed HEAD without restarting the running server
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "check_rules named the new HEAD e3324b0f69 but returned the old 0 violations and 24 unjudged in 1.8 s; the current inspection CLI over the same region finds 111 new absence violations and 30 absence unjudged. Restarting the server is forbidden, so the check through the door does not prove the new implementation.",
    "command": "check_rules({rules:[\"ea465bed\"],over:\"all\",limit:168}) after e3324b0f69",
    "expected": "The measurement lets the landed swallowed-failures extension be checked without a server restart, or clearly names the running reader revision."
  }
---
Filed from project `runlith`.
