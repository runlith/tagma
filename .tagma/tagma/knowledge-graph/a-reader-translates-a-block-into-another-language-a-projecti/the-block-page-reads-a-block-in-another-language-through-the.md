---
id: 01a188e0-9a57-7a9f-aae1-5224da0720dc
title: "The block page reads a block in another language through the translation lens: menu entry, language and model in the strip, outdated parts"
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a188b6-199d-7ef5-9da5-32671d5f53a4
  - kind: waits-on
    to: 01a188e0-86a1-7f1e-b49c-ee04ac4d610a
---
App half of the spec, inside the Project graph module: the diff lens strip extracted into one component both lenses use; the translation lens at `?lang=<tag>` (pane state in an aside); the block menu entry and palette commands; the language menu and the model chip (`CatalogPicker`) in the strip; parts landing in place, outdated parts showing the current original, failure and no-model callouts; translated link titles and same-language link following. Built on the server operations and frames of the server task.