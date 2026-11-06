---
id: 01a1b2c8-4ce0-7617-9163-191176747387
title: Fix the review findings of Tagma-format hooks and prompt commands
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1b15d-07d5-7762-ad3c-66b601e63162",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a1b2a5-cd55-7022-b6a6-13ebb42ad34f
---
Confirm and fix the findings of both reviews of task `b42ad34f`: a `beforeStep` block that does not stop the message, catch-all tool hooks reaching other owners' tools, a missing verdict passing as `{}`, timeouts cut at 60 s, the hook event and answer declared twice across the SDK boundary, and the rest.