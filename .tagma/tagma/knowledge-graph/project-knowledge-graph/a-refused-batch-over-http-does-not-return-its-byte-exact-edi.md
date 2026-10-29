---
id: 01a0d62c-eb4e-7ec0-b2af-b02301bf3324
title: A refused batch over HTTP does not return its byte-exact editable input file
ord: 217
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d938-ccce-7f34-b019-9e355ec5986b",
    "status": "done"
  }
---
`apps/tagma/server/src/http/standingDoor.itest.ts`, "a refused batch returns its byte-exact editable input file over HTTP", fails alone and in every full run since at least 2026-09-24 (it failed under the old preload too): a list expected empty has entries. Done when it passes and leaves `test/failing.json`.