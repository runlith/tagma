---
id: 01a14bae-4498-7d2b-9809-f52fa117fc42
title: "No operation adds a tag to an existing block: retagging a note means creating a copy and superseding the original"
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "update_block takes only title, body, bodyFile, status, fields, parentId and ord; apply_batch `tags` is documented \"Create only\". The only route is to create 35 new #feature blocks and supersede each note: every id changes, and a reference written against an old id must be corrected by hand.",
    "command": "update_block / apply_batch update on an untagged note, to add the project tag #feature (35 notes under f8fe83a4 in runlith)",
    "expected": "One act gives an existing block a tag (or tags), keeping its id, place and references, and checks the tag's gates and sources."
  }
---
Filed from project `runlith`.

Checked with `tagma op read_operations {"ids":["update_block"]}` (input properties: project, blockId, title, body, bodyFile, status, fields, parentId, ord) and apps/tagma/server/src/graph/contract/wire/operations/work.ts (batch op schema: `tags` — "Create only"). Consequence in this run: the area-division block cb83ce5d had to be edited to point at the successor of 58042986, and the ids already reported to the parent agent became stale.