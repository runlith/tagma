---
id: 01a0c6f0-284c-7bfa-bda7-e179aee8c068
title: "ActivityLog.record only puts the fact in memory: no file access, no waiting, no throwing into the work it observes"
ord: 15
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/activity/src/log.ts
    symbol: ActivityLog
---
A fact the store does not accept or record is counted and shown as a loss row instead.