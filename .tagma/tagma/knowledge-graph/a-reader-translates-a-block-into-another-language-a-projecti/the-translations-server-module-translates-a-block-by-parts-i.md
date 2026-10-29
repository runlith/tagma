---
id: 01a188e0-86a1-7f1e-b49c-ee04ac4d610a
title: The translations server module translates a block by parts into a stored projection through translate_block, read_block_translation and stop_block_translation
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188e1-0a3e-7f0f-90a6-391afc0f5a68",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a188b6-199d-7ef5-9da5-32671d5f53a4
---
Server half of the spec: the `translations` module with its card under Knowledge graph, the subject-agnostic translator core (parts, placeholders, batches, frame check), the module's store, the three operations and their live frames, the model chain taking a context instead of a thread, the four `translation.*` settings, one activity per act, and removal of a block's rows when it leaves the trash for good. Acceptance 1–10 of the spec that the server carries; integration tests through the operation door with a scripted model.