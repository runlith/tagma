---
id: 01a18d50-f22d-74ae-bda5-a7f2acafebe1
title: A module's imported-module count and external-import share never grow above their recorded ceilings
ord: 25
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/server/src
  - kind: dir
    ref: packages
  - kind: dir
    ref: apps/tagma/app/src
  - kind: dir
    ref: .tagma
  - kind: file
    ref: package.json
  - kind: file
    ref: apps/tagma/server/package.json
  - kind: file
    ref: apps/tagma/app/package.json
---
Measure production literal imports in server, app and package modules. A new module starts at the project median; a reduction lowers the ceiling for the next change.