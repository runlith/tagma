---
id: 01a13297-9fdc-7582-80f8-5d2726e58ea2
title: One record's metadata and hunk are stored separately, so stamping never rewrites the overflow payload
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a13257-1988-73bc-9664-5607527738d1
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/record/hunks.ts
    symbol: putHunkText
  - kind: symbol
    ref: apps/tagma/server/src/change-record/record/intake.ts
    symbol: insertRow
  - kind: symbol
    ref: apps/tagma/server/src/change-record/store/tables.ts
    symbol: workspaceChange
  - kind: symbol
    ref: apps/tagma/server/src/change-record/store/tables.ts
    symbol: workspaceChangeText
---
One record's metadata and hunk are stored separately, so stamping never rewrites the overflow payload.

The hunk is separated from metadata so a state transition never pays for reading and rewriting large SQLite records. The pair belongs to one logical record: intake and splicing change it in one write unit, and readers join both halves in one SQL statement. A missing half answers with the same null contract as a collected hunk; geometry, digests and counts stay in metadata. The FK over the full PK cascade-deletes the payload with the record, while collecting it never deletes the metadata or the released witness ([[c851d6c3|text storage and collection]]).
