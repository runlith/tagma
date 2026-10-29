---
id: 01a14c05-71a7-71c8-88a1-ee5201606b20
title: The operator returns the machine database's free pages to disk
ord: 25
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/operations/vacuum.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/vacuum.ts
---
**Value.** Space freed by deleted data returns from the machine database to the filesystem.

**How.** The `vacuum_database` operation, reached via `tagma op` and an agent tool under the normal approval mode.

**Behaviour.** A full rewrite moves the database into gradual page-by-page reclamation afterwards. Before it, room for the copy is checked; the answer shows size before and after, freed pages and the time the database was held. The store itself performs further freeing in portions.

**Limits.** While the full rewrite runs, other requests wait; on a large database that is a noticeable service pause. The act concerns this server's machine database, not an arbitrary file and not Tagma's whole directory. Without enough disk the rewrite does not start.
