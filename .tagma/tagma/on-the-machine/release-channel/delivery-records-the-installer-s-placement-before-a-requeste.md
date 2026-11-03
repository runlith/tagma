---
id: 01a1a26d-2cc4-75a3-9fed-c9157dd94b97
title: Delivery records the installer's placement before a requested restart
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/release-channel/runner.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/installer.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/placement.ts
---
An exit code proves that an installer answered, not that it moved current: held and ask are successful protocol replies. Delivery persists the decoded placement before cleanup or restart so an interrupted parent cannot manufacture a landing or turn a held release into a failed attempt; only a landed placement permits the requested restart. Held and ask retain the existing stopped terminal outcome for issued readers, while the optional placement carries the exact result to readers that understand it.