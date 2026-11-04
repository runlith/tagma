---
id: 01a1a318-0df7-77a4-a222-de920b86b486
title: The machine registry file is assembled from parts its table owners contribute; installation composes them and knows no table
ord: 49
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1a311-f5a0-7419-9dcd-1fcd8be52798
  - kind: relates
    to: 01a1a2cf-058e-7f33-a6cd-6d6dc7e9bcae
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/registry/file.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/machineRegistry.ts
---
`registry.json` beside the machine store is the copy a lost database is reseeded from. Each section belongs to the module whose table it copies, and that module contributes a part at `platform/machine-registry`: the section, its row fields, the tables its restore writes, its dump, and the owner signal after which the file is written again. Installation composes the parts composition collects and knows none of their tables: a new table that must survive a lost database is a part in its owner's manifest, never an edit in installation. The point stands in platform because the owners lie below installation in the module order; a point installation declared would close a cycle.

- **Shared sections.** Parts naming one section are written as one row each, joined on `id`: the graph's project policy rides on the `projects` rows because the format issued releases read carries it there. A joining part dumps one row for every row of the section's first part — the graph coalesces a missing policy to its defaults — or the joined row lacks a field an issued reader requires and that release refuses the file.
- **Dump.** Every part of one file reads the same database snapshot, through the read unit it is handed, and the assembled sections are read back by each part before they replace the file. Separate reads let a registration taken back between the projects and the policy dump leave a `projects` row without `storage`, and that file would have replaced a readable one though no release reads it; a section that does not read back now fails the dump `RegistryIncoherent` and the file keeps its last readable copy.
- **Restore.** A store holds registry rows when any table a part declares, among those its schema has, holds a row: boot then dumps instead of seeding. Otherwise every section is decoded with each part's own fields, ignoring fields the part does not name, before the new store is built, and the parts seed one transaction in contribution order: modules in composition order, parts in their declared order. Members, settings and policy rows point at `project` by foreign key and therefore come after the projects part. Only a part marked `optional` reads a section an older file lacks as no rows; any other missing or unreadable section refuses `RegistryUnreadable`, so a damaged file never reseeds an empty machine.
- **Re-export.** A part without a signal is written again on another part's: group members change only through registry acts, which `ProjectChanges.changed` already announces. A signal the running server does not provide stops the start (`RegistrySignalMissing`) instead of leaving the file stale.
- **Frozen shape.** The file crosses releases ([[c7e9bcae]]): the parts' fields, merged per section, equal `NEXT.registry`, and changing them follows the freezing rule there.
