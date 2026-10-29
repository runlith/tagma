---
id: 01a0de23-5758-71cd-8998-b6c06df189c0
title: "A held path standing as the branch carries it settles: the discharge compares the working file with HEAD's blob, and a landing with nothing to land still discharges"
ord: 84
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de17-2c92-7c71-ab40-546a507a975f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0dbf2-1f4b-77ee-9d89-db450f13462b
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/record/discharge.ts
    symbol: dischargeCarried
  - kind: symbol
    ref: apps/tagma/server/src/landing/land/submit.ts
    symbol: submitWork
---
Reflection [[0f13462b]], measured in the record: row `01a0dbc2-af30` (session 01a0db82, a blank-line restore at commands.ts line 7, provable by no window) stayed held from the 9a04b1d4be landing (04:08:07, its sibling row stamped) until the reboot pass at 04:22:15, while the working file equalled HEAD. Two causes at the producer:

- `dischargeCarried` decides "the file stands as the branch carries it" from `git status`, which also reads the shared index; a stale or not-yet-synced index entry, or a failed reading, reads a clean file as changed and skips the clean-path road.
- `submitWork` answers `nothing` before any discharge, so the session's own call at 04:20:48 (`paths` naming both files) settled nothing.

Done when: the clean-path road compares git's blob of the working file with HEAD's entry (index-independent, filter-aware, only over paths holding outstanding rows), a landing that builds nothing still discharges its held paths, and both are covered by integration tests that fail on the old code.