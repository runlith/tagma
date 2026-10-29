---
id: 01a0d55b-28a5-7d90-9254-8d0f99d493b0
title: Add a batch blob reader to `@runlith/git`
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d55c-c5dc-77f0-ad14-26350f47b929",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d4db-9d7d-7a78-ab39-a9d0f2755a5b
---
One `git cat-file --batch` session that answers the texts of many `<tree>:<path>` requests, for the judgement's two sides ([[f2755a5b]] Facts). Done when a test reads many blobs of two trees in one process, missing paths answered as absent.