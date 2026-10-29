---
id: 01a0d599-11a6-745c-b9cf-cf6e369828ac
title: "A migration that deletes or renames a setting row is undone at the next boot: the machine registry seeds back every row the database lacks"
ord: 51
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d56a-99a9-7ac1-9410-7c033624e501
sources:
  - kind: symbol
    ref: apps/tagma/server/src/installation/registry/restore.ts
    symbol: machineStoreLayer
---
`machineStoreLayer` opens the store — which runs the pending migrations — and only then runs `seedMachineRegistry`, which inserts every `registry.json` setting row whose `(scope, key, project)` the database does not hold. The registry was dumped before the migration, so a row a migration deleted or renamed is inserted again from the file, and the next dump keeps it.

Measured on a beside installation (2026-09-24): after `20260924223731_terminal_place_layouts` converted `terminal.tabLayouts` into `terminal.placeLayouts` and deleted the old row, the next boot held both rows (ids 8 and 9), the old one revived from `registry.json`. The same happens to `20260922040000_a_rest_is_measured_from_movement` (renames `threads.archivedProjectionDays`: the old key comes back beside the new one) and `20260923224243_command_profiles_withdrawn` (deletes `commandPolicy.*`). An undeclared key is invisible to resolution (`resolveCatalog` walks declared keys only), so the revived rows are inert today, but a migration's delete is not a delete.

Fix at the owner: the registry must not revive what a migration removed — for example, dump the registry once the chain has run and before seeding, or seed only a database the chain created empty. Done when a migration's delete of a setting row survives a restart of an installation that has a `registry.json`.