---
id: 01a189c1-b109-7e0e-805c-c7506c119b97
title: A marketplace's stored list is the list text kept in its revision stamp, published together with its clone
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/marketplaces/revisions.ts
---
A marketplace's entries change only when it is added or refreshed, and a failed refresh keeps the last list that read. So the list text itself is kept in the revision stamp, and a restart parses that text rather than the clone or the folder: editing a folder marketplace while the server is down, or a clone that went missing, changes no entry until a refresh. A new revision is published as one step — the stamp is written beside the new clone first and both replace the former only together, the former restored if either rename fails — so a refresh never leaves a stamp of one revision over the files of another. An entry's relative path still resolves against the folder or the stored clone at preview time.
