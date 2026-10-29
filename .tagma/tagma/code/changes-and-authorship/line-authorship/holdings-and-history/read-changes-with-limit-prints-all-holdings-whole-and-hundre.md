---
id: 01a14c85-575a-742c-b3d3-8608878745a1
title: read_changes with limit prints all holdings whole and hundreds of unrelated overlap paths
ord: 12
tags: ["reflection"]
fields:
  {
    "actual": "At limit:10 the tool printed all 87 held paths, 10 turns, and hundreds of unrelated overlap paths of packages/other agents; limit bounded only turns. The big unasked table took about 30 KB of context.",
    "command": "read_changes({\"limit\":10})",
    "expected": "A bounded current-change answer: no more than the requested page of lines, full totals and cursors for the other sections, with no full listing of others' overlap paths."
  }
---
Filed from project `runlith`.

The request served to pick own paths after lines-held at a readonly style inspection. The full set of others' overlap paths did not help pick them and had no page of its own. Narrow path-readings serve the continuation; holding tables and unattributed need their own bound/cursor page.
