---
id: 01a13dd9-c6fd-79d8-8f83-86c60434192d
title: read_brief says the task names no code, though it carries directory sources
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "The answer writes \"The task names no code: anchor it where the work lands\", though read_block of the same 08aa72d5 shows sources apps/tagma/server/src/graph and apps/tagma/server/src/composition/testing/graph; read_owners for the serving tests finds owner d962023e. The owners had to be read separately instead of through the brief.",
    "command": "read_brief({scopeId:\"08aa72d5\"})",
    "expected": "The brief carries the owners and scoped law of the task's two directory sources, or explicitly names why those sources were not read."
  }
---
Filed from project `runlith`.

The defect's layer is working-brief delivery in graph/orientation. The tool saved the full read_brief answer in cb3ccb9c3061eef9e887783936df9fb1; line 249 holds the false message. The directory sources did not change between calls. This work did not fix the code.
