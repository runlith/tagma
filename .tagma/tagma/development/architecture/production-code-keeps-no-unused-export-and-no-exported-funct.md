---
id: 01a18d50-f176-71f1-943b-2146aabef712
title: Production code keeps no unused export and no exported function without a production caller
ord: 24
tags: ["rule"]
sources:
  - kind: dir
    ref: packages
  - kind: dir
    ref: apps/tagma/app
  - kind: dir
    ref: apps/tagma/server
  - kind: file
    ref: package.json
---
A published package entry or a runtime contribution consumed through its declared framework contract counts as a production consumer. Reach through tests alone does not.