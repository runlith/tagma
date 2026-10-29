---
id: 01a0c6f0-284c-7bfa-bda7-e179aee8c068
title: "ActivityLog.record neither blocks nor throws into the observed work: what is not recorded counts as a loss fact"
ord: 15
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/activity
  - kind: symbol
    ref: packages/activity/src/log.ts
    symbol: ActivityLog
---
On the main thread, record only puts a fact into memory, with no file operations or waiting; a fact the store did not accept or record counts and shows as a loss row.
