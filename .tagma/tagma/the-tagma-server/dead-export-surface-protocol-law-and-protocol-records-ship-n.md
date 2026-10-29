---
id: 01a0caf1-2122-7fa5-bc7f-0226ab2192df
title: "Dead export surface: `protocol/law` and `protocol/records` ship nowhere"
ord: 157
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/package.json
---
`./protocol/law` and `./protocol/records` are carried by the export map and the walked browser-entrypoint list, but no shipped bundle contains them: zero package-specifier imports anywhere including tests, and their only relative importers are five server-internal files (`Orientation.ts`, `Tags.ts`, `Reflection.ts`, `workspaceSources.ts`, `skill/install.ts`), none of which stands under `api/`, `socket/`, `protocol/` or any shipped entrypoint. (Their three siblings — `commandPolicy`, `findings`, `projects` — ship through the door and are live boundary.)

Done when the two entries leave the export map and the entrypoint list, or a consumer that ships them is wired.