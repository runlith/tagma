---
id: 01a14c05-71a7-71c8-88a1-ee476cec84de
title: The user steps back to the saved previous installation, and their data goes back with them
ord: 14
tags: ["feature"]
fields:
  {
    "state": "partial"
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
  - kind: file
    ref: apps/tagma/server/src/composition/returning.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/returning.ts
  - kind: file
    ref: apps/tagma/server/src/checkout-builds/runner.ts
  - kind: file
    ref: packages/sqlite-process/src/chainReturn.ts
---
**Value.** The user returns to the saved previous installation when the new release does not suit them, whatever the new release's migrations did to their data.

**How.** Previous installation in the installation chip, `tagma release back`; in a developer build `tagma update --back`, the checkout's Previous installation and a build script with return. Asked while no server runs, the step back lands at the next start. A separate `prepare_downgrade` operation prepares the data before switching.

**Behaviour.** The step back closes commit-queue admission and makes sure it is empty, then records which release it leaves for which; it moves the selected installation itself only onto the release that already runs, whose data needs nothing. The restart that applies it starts the leaving build once more, before its server loads: under the data directory lock it copies aside each store it is about to change and returns every SQLite store — machine, activity, evidence, module stores, graph mirrors and idle execution hosts — onto the previous installation's own migration chain, so the older build finds exactly the schema and ledger it wrote, with every row it can hold. Only then does the previous installation become current and take over, as an update attempt of its own. A failure on either side puts the copies back, the leaving build serves again, and the chip says why. A running execution host returns its store itself as it yields to the older host. A restart onto a selected installation that cannot open the data becomes this same step back through the running build. The window follows the choice, and reopening the new copy asks whether to update again.

**Limits.** This is a return to the neighbouring saved installation, not a choice of any release from history. What only the leaving build could hold — its own tables, columns and values — stays behind, and the log counts the rows of each table left out. A value a newer migration rewrote comes back in the older shape only where that migration carries a script reversing it. A thread journal the newer build already reshaped stays in its newer form, and the older build cannot open that thread until the newer one stands again. A first installation has nothing to return to.
