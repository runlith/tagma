---
id: 01a14cbd-9f15-76c0-8c89-57a33c9ac977
title: read_inspections does not bound the saved-inspections page
ord: 5
tags: ["reflection"]
fields:
  {
    "actual": "The call returned 114583 bytes and was cut: after one builtin, the full inspections of all 18 rules repeat, including the big swallowed-failures allowances list.",
    "command": "read_inspections({limit:1})",
    "expected": "One builtin line and a bounded description of the available runners; saved policies are read separately via read_enforcement."
  }
---
Filed from project `runlith`.
