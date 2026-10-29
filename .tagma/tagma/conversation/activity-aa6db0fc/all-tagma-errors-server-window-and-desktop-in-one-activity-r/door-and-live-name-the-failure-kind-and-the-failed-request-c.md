---
id: 01a179c9-bfb4-76ab-8a43-403c29f125c8
title: Door and Live name the failure kind and the failed request; consumers decide by kind, not by gate and codes
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a179c9-bfb4-76ab-8a43-403ac8860d90
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Door.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Live.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/liveFailure.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/refusal.ts
---
A `Door` refusal carries the kind (`refused`, `server-fault`, `lost`, `apart`, `defect`) and the operation id with a lens, a `Live` failure — the kind and its feed's id. `refusalOf` no longer singles out `not-found`; `catchDefect` yields `defect`, not an `http` refusal; the window knows the contract it was built with, and an unreadable answer under the same contract is a `defect`, while `apart` is only for a different one. `Notices.refusal`, `Notices.background`, `ThreadRecap`, and other `gate` readers move to kind per the [[c8860d90]] spec table.
