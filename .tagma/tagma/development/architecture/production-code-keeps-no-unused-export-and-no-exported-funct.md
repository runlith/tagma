---
id: 01a18d50-f176-71f1-943b-2146aabef712
title: Production code keeps no unused export and no exported function without a production caller
ord: 24
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/server/src
  - kind: dir
    ref: packages
---
A published package entry or a runtime contribution consumed through its declared framework contract counts as a production consumer. Reach through tests alone does not.