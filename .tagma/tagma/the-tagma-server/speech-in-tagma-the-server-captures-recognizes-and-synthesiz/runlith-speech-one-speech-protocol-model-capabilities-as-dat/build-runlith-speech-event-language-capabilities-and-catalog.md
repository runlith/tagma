---
id: 01a1050d-b653-758c-bca6-883f49f6844e
title: "Build `@runlith/speech`: event language, capabilities and catalog, duplex runner, recognition and synthesis sessions, `Segmenter`, `Speech` service"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1050e-6093-75b1-8e1f-f17763f9cb47",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff30-3ce0-7879-8c00-c379d3bd40f5
  - kind: waits-on
    to: 01a1050d-b653-758c-bca6-883e76715af2
---
New `packages/speech` package per spec [[d3bd40f5]]; sound types come from `@runlith/audio`. Done when the tests from the “Proof” section are green through the public `Speech` service and the package has its `#module` card.
