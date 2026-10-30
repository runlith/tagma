---
id: 01a18e9f-f22d-7254-85c3-340f54d3abf2
title: Pack translation batches within both the input and output budget
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e90-ac8f-7e3f-b6e5-5faf5fe88765",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18cbf-9775-75eb-a4a1-6542bcec10b7
---
Translation batching currently uses only the selected model’s output budget, so a model with a smaller input allowance receives one oversized batch even when its parts would fit separately. Include the shared capacity’s input budget and the framing overhead when packing, and prove the split through translate_block.