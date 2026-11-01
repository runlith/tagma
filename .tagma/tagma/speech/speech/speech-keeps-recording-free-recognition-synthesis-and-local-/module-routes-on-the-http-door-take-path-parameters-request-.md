---
id: 01a195a0-b898-7ab8-8c6a-7726f7530768
title: Module routes on the HTTP door take path parameters, request headers and a right
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19566-b9f4-714b-a26b-081514b813d5",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a1956f-d780-7c1a-8b6f-809c556ba27b
  - kind: waits-on
    to: 01a19592-6a37-77d0-83a2-aa74bae2b2d4
---
Item 6 of [[556ba27b]], extending the manifest routes [[bae2b2d4]] builds instead of a second mechanism; its acceptance: a test module serves a file by id with a `Range` request under its own prefix, refused `right-missing` when `Access` answers `none`.