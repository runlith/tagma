---
id: 01a188f8-0dc7-772f-a5e5-e4f2cd68c51e
title: "A projection part is keyed by the hash of its current source, and a running act lives only in memory: a stored act with no ending reads `stopped`"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/translations/acts.ts
  - kind: file
    ref: apps/tagma/server/src/translations/store/projections.ts
---
A translated part is stored under the hash of its kind and source text, never under its position, so an edit that inserts, moves or rewords one block leaves every other part's translation matching and sends only the changed ones. Identical blocks share one row. Rows of sources that no longer occur are dropped only when an act for that block and language ends, so a read between edits still finds what it may show.

The act row records its model, rung and start at once, and its ending only when the act ends. Whether an act is translating is the in-memory act registry's answer, not the row's: an act cut by `stop_block_translation` or by the server ending leaves a row with no ending, which reads `stopped`, and its landed parts stand, so the next press sends only the rest. Storing a `translating` state instead would read as running forever after a crash.