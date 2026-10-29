---
id: 01a15ec6-760e-7a2c-9f97-2bb67cf067fb
title: "Step 1: a voice — an effect in the call context, model-ready text through ToolAnswer, one call executor"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ac1-2b9a-7fc6-b993-3b1f606e8186",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eb1-1b10-757c-ac79-89ebc8d8b62b
---
No behavior change. Operation presentation resolves in `invocation` on today's voices (its own `voice`, `spoken`, the graph and thread "families"); the voice is a `voice(answer, input, at)` effect with a budget and `VoiceUnrendered`, the native door counts the text in the same `placement.serve` as the body and hands it to the model ready-made through `ToolAnswer`; `performByIdIn` and `performMediaByIdIn` merge into one call executor, which the door tells what it needs.
