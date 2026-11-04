---
id: 01a1a76d-6078-72c9-8e98-249721c487df
title: Machine power keeps the macOS caffeinate helper in a table inside the shared power module
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0eaa1-2c4c-7cbd-9014-d7496f758080
  - kind: relates
    to: 01a19ec6-f467-787a-a87e-89cb77c57d56
sources:
  - kind: file
    ref: apps/tagma/server/src/power/sleepAssertion.ts
  - kind: file
    ref: apps/tagma/server/src/power/power.ts
---
The idle-sleep assertion is a per-OS table in the module's shared file: `darwin` holds the `/usr/bin/caffeinate` helper and its user-facing limit text, and every other platform answers that none is held. The manifest passes `process.platform` in.

Read at ee24295b8e:
- `power/sleepAssertion.ts:8` `CAFFEINATE` path; `:10-18` `HELPERS` keyed by platform; `:20` lookup by platform name.
- `power/power.ts:22` `idleSleepFacility(process.platform, process.pid)`.

Done when the module declares a sleep-facility port, the caffeinate helper is a macOS adapter composition fills, and the module's tests pass on a Linux runner.