---
id: 01a14c05-71a7-71c8-88a1-ee476cec84de
title: The user returns to the saved previous installation if it can read their data
ord: 14
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee48e7ff5201
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee51b44224b6
sources:
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: file
    ref: apps/tagma/server/src/cut/build.ts
  - kind: file
    ref: apps/tagma/server/src/installation/operations/downgrade.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/offers.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/runner.ts
---
**Value.** The user returns to a saved previous installation when the new release does not suit them.

**How.** A return action in the installation chip, `tagma release back`; in a developer build — `tagma update --back` and a build script with return. A separate `prepare_downgrade` operation prepares the data before switching.

**Behaviour.** Returning checks that the previous installation can read the data and closes commit-queue admission while making sure it is empty. Then it switches the selected installation and restarts the server. The window follows this choice, and reopening the new copy asks whether to update again. Manual preparation may carry console keys into the named snapshot copy and reports completed and skipped steps separately.

**Limits.** This is a return to a neighbouring saved installation, not a choice of any release from history. Irreversible changes and unreadable data close the way back. Preparation alone does not switch the program, and returning an already-running release does not roll back arbitrary user-data changes.
