---
id: 01a13257-1967-73ee-a25d-c60dcd2b01b3
title: Landing evidence carries references; its owner reads content and authorship
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/evidence.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/retire/store.ts
---
Prepared uses evidenceInGroups to pick its own and other sessions’ record ids and digest sets; it never needs hunk bodies, full texts, or ended. Holdings of the same preparation gives holders and their retired state. Full evidenceOfPath keeps texts for the readers of that contract; retirement fetches hunks only for released witnesses, and the committed stamp needs metadata plus after-CAS.
