---
id: 01a17444-91bf-735d-972c-90c9b39495df
title: Smooth the floating activity chip and make the jump-to-tail button prominent
ord: 66
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17420-65f9-78fc-b75b-4165c628c477",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14bc0-754e-7774-9bf0-abe5760fe634
---
Make a floating chip on the sidebar's opaque background with a "Jump to latest" label without a run, natural width with a 150 ms transition and soft text change. A concrete action appears after 250 ms and gets at least 500 ms of display with no false running; human waiting and the run end reflect at once. The feed at the tail stays delay-free. Check time transitions through the view owner's public contract and keep synchronous work marks.
