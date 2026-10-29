---
id: 01a1559e-5577-7a1d-85ed-df6b98ceb5a3
title: list_root_blocks prints a "1 of undefined" total
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "Reply \"ec043c48 [note] law-lab / 1 of undefined\" — undefined leaked into the total",
    "command": "list_root_blocks(project=\"law-lab\")",
    "expected": "The total line names the root count or says the total is not counted"
  }
---
Filed from project `runlith`.

The project was just registered (id 39), the graph holds a single root. Other total-printing reads print a number or "not counted"; here an undefined value went into the text.
