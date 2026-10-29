---
id: 01a12a42-74dc-78cc-afac-ebc3d61f9a88
title: submit_work names paths as still held after a landing that left the tree clean
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "landed 4b9a7ae02d and listed server.ts, hostChange.stest.ts, candidate.itest.ts and offer.ts as \"lines of this session still stand uncommitted\", while git status shows all four clean; the same four were listed after 9ec8d3d9c3 and 0409addfce too",
    "command": "submit_work {paths:[\"apps/tagma/server/src/executions/host/offer.ts\"], whole:true}",
    "expected": "left lists only paths where this session's uncommitted lines still stand"
  }
---
Filed from project `runlith`.