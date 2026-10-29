---
id: 01a172fb-3d3f-7afe-9984-a811cc8517cf
title: Define how tasks link to a landing's subject with several held tasks
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17da7-2e07-7426-95d5-f31881b7adb0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16e5c-f58c-7795-9362-03520b5838a5
---
The current contract adds all active WORK tasks of its own session and taking from the place's graph to the subject, with no link to paths. In the source case the journal refutes two tasks under one holder: 6b505131 moved from session 2926 to 2831 in claim 265450, before commit 4632b5eec6; 9406c155 stayed with 2926. By sighting 16f05224fb task 6b505131 was already done. No path-based selection exists: HeldTaskLabels.forHolders → heldTasks → messageOf. Product question: allow an explicit task set in submit_work, keeping all held tasks in the receipt for reference? Recommendation — yes; this removes unreliable linkage to code without heuristics over optional sources, but requires naming tasks when ambiguous.
