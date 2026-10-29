---
id: 01a118cd-de77-77a9-b193-077e54161a0c
title: Writes to a checkout from this module go only through Intake, on the operator's behalf
ord: 3
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-files
---
Creating, editing, moving, and deleting a file take the Intake turn on their paths and land inside Intake.land with the operator as holder. Only creating and deleting a directory with no files write no fact.
