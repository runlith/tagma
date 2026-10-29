---
id: 01a112a4-c598-7d84-ba41-54694007bb8d
title: Settings and credentials are checked with no shared transaction with the recap write
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/recap/schedule.ts
---
When a recap is published, its basis, project, status and the stored provider/model/reasoning/account selection are re-checked in one MachineUnits write unit. GraphStore settings and the external credentials selection share no transaction with it: a setting or account may change between the last live/auth read and the commit. Worst outcome — an already-paid answer is published right after the automation is switched off or the account changed. That is one visible summary with no repeat, on a consistent conversation basis; stored summaries still show with the setting off. Cross-store atomicity for this would cost incomparably more than the effect it prevents.
