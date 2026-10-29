---
id: 01a0d136-c409-74c8-b161-b53779b59d15
title: "Redraw the thread row: one-state dot, a second line that says what it does, model+effort and ring in aligned columns, width tiers, UI-face time"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d138-dbb9-74e0-9449-ec3fdd5247d3",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d136-c214-7131-a5e1-ff49fd277fc5
---
Build the row of [[fd277fc5]] in `ThreadRow.svelte`, `ThreadLife.svelte` (`threadMark`), `ModelPlate.svelte`, `ContextRing.svelte` (red from 0.8, cache dot at centre — shared with the conversation rail) and `ActivityBadge.svelte` (running count only on the row). Fields the server does not carry yet (`ask`, `saidLine`) leave their line empty. Done when the decision's acceptance holds at 480/400/340/290/250px on the page's data; then write the claims the new row stands on and settle the claims [[f943c3ed]] sentences as dying or absorbed into this task (supersede or rewrite, including [[77e8586b]] and [[e8a28eaf]] under the conversation area). Size: high.