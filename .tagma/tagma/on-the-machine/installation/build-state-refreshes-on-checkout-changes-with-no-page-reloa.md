---
id: 01a130d6-d59f-7521-a512-725d2092aa9b
title: Build state refreshes on checkout changes with no page reload
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a130cd-1baa-7a77-a2f2-5ededda3df22",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Standing.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/composition/buildSource.ts
  - kind: file
    ref: apps/tagma/server/src/installation/builds/reading.ts
  - kind: file
    ref: apps/tagma/server/src/installation/operations/machine.ts
---
Fix installation-state freshness: an open page must receive the new commit and changed-file counts when the source checkout changes, keeping the single owner of the computation and releasing subscriptions on close. Start with Standing and read_machine_state, tie the refresh to the owner's existing change record. Completion is proved by contract checks of fresh-state delivery without reload, connection recovery, no repeated full recompute per tab, typecheck, and a landed fix.
