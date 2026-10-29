---
id: 01a16e61-1088-7cf7-950d-9c725fe66065
title: Session facet and thread model choice are recorded in one write before afterCommit
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/contract/service/sessionRows.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/store/rows.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/testing/memorySessions.ts
---
Readers after commit and the next lease owner must see consistent changes, even when a callback was registered before the facet write. So SQL and memory tie session state to the same core transaction; afterCommit publishes already-kept state instead of keeping it.
