---
id: 01a16477-6571-720e-984b-31784612d2f4
title: SettingChanges arrives after the setting's live-readers update
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/settings/writes.ts
---
An event's subscriber can immediately read `Settings.held` and act on that value with no repeated SQL query. So the new value is published to live-readers first, then the event — after the write's commit. The reverse order would show a stopping resource the previous enabled value and leave it running after it was switched off. Both `live` and `held` register before the initial read: an event arriving during that read is not overwritten by the old snapshot from it.
