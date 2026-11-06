---
id: 01a1b1c8-21c2-7fd0-a938-a84e50821ad8
title: Build the fresh world of the published release in Tagma Dev and remove the channel switch (spec f6325236)
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1b1b1-edde-7f4b-a8ea-54f2e8f5628f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1b1c0-98e5-732c-b08b-923bf6325236
---
Implement spec f6325236: the developer module `fresh-world` (operations, `tagma-dev fresh` verb, Tagma Dev menu items), its macOS adapter, and the removal of `tagma switch` and the waiting page's switch act. Measure keychain resolution and `open --env HOME` first.