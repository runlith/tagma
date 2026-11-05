---
id: 01a1a2d6-a289-7e2c-90db-b664226d7ad4
title: A cut asks whether HEAD needs its release source, and its disk images are made from the brand assets the cut carries
ord: 93
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a18-7360-ba89-67591ec4329c",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a1361b-0306-7539-b5f1-3cd46c675b20
  - kind: relates
    to: 01a16915-34b6-7bf8-9a01-c8c56bc98bc4
sources:
  - kind: file
    ref: apps/tagma/server/src/mac-release/notarize.ts
  - kind: file
    ref: apps/tagma/server/src/cut/publish.ts
  - kind: file
    ref: apps/tagma/server/src/cut/stage.ts
---
A release entry that freezes the source needs to know whether a fresh cut will happen: `needsReleaseSource(checkout, cut)` is true only for a HEAD with no standing cut and no release tag. A resumed notarization after HEAD moved must not read live brand art: the cut keeps `brand`, landNotarized carries it to the notarized cut, and `Apple.image` takes the cut's assets directory when it stands.