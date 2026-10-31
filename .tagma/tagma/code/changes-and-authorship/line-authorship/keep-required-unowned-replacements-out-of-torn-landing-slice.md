---
id: 01a1845b-d958-76c1-b86e-adadca8cb29c
title: Keep required unowned replacements out of torn landing slices
ord: 147
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18458-5f0c-7431-91d2-1c838c666d29",
    "status": "done"
  }
---
Fix both sightings of reflection 6466f375 at their producers: preserve the initial base's line identity across an undo/redo branch, carry a command team's observed version only through explicit root taking while that version still matches, and refuse a required unowned replacement before assembling a torn slice. Prove the restoration and Hono ternary scenarios through native submit_work, run affected tests and typecheck, obtain one independent review, and land the fix.