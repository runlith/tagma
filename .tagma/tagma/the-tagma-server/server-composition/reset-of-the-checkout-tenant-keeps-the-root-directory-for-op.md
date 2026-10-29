---
id: 01a16d0e-eafb-7d21-ba9c-591413c536b3
title: Reset of the checkout tenant keeps the root directory for open git sessions
ord: 37
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/checkoutFixture.ts
---
The checkout fixture copies one git template before a scenario and clears the scenario's records in the shared database. The root directory itself stays in place: the `cat-file --batch` process opened by the kit holds it as cwd; deleting the root and creating a directory at the same path would leave the process in a deleted inode, and subsequent object reads would fail.
