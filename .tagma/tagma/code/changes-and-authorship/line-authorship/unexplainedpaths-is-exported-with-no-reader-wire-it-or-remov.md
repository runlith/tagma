---
id: 01a0cac4-a162-79be-816c-d603a635aa0b
title: "`unexplainedPaths` is exported with no reader — wire it or remove it"
ord: 86
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/record/observations.ts
    symbol: unexplainedPaths
---
`unexplainedPaths` is exported from the change log and answers the names-alone reading — paths no record explains — but nothing in `src` calls it, and the submit receipt carries no unexplained field. Either a door was meant to surface unexplained paths and never landed, or the export is residue beside the readers that did.

Done when the reading has a reader (wired into the receipt or a door) or the export goes.