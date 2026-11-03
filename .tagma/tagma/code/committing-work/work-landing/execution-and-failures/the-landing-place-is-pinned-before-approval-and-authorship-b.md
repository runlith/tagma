---
id: 01a127b5-27f2-7654-ac38-a1258d36f8af
title: The landing place is pinned before approval, and authorship belongs to the home
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/place.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/selection.ts
  - kind: file
    ref: apps/tagma/server/src/landing/operations/submit.ts
---
An approval covers one selected checkout: a checkout appearing while awaiting never redirects the call, and the receipt and `left` describe only its tree. When the caller's own rows don't set the place, the foreign checkout is named explicitly. Rule judgement, commit shape and tasks belong to the place's graph; execution authorship and custody belong to the holder's home. Mixing these coordinates would either judge another's commit by home law or strip the session of its rows.
