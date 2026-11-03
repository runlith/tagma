---
id: 01a1a2cd-be89-7524-b0ed-c8b5a781f1e6
title: A tagged HEAD's source maps are complete by a completion record and are repaired from its standing cut without the publisher, notary or feed
ord: 91
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2bb-33ee-76fa-bb2d-1d7445b0686d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1a2be-316b-7df6-963d-8b104acbba52
  - kind: relates
    to: 01a1361b-0306-7539-b5f1-3cd46c675b20
sources:
  - kind: file
    ref: apps/tagma/server/src/cut/maps.ts
  - kind: file
    ref: apps/tagma/server/src/cut/publish.ts
---
`ship` trusted `kept/<release>` by existence, so a directory left partial by an older cut passed, and a tagged HEAD whose maps were lost went back through notarization and the publisher, where a newer feed refused it. Kept maps carry `kept.json` (release, commit) written in staging before the rename; `ship` on a tagged HEAD with a standing cut of that release copies the maps again unless the record matches, and refuses `maps-refused` naming the missing data when the directory is absent and no such cut stands.