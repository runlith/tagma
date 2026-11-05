---
id: 01a1aca1-bdf1-7ea7-9662-67b9f2af3ac0
title: A setting reset keeps its row with no value, so the newest row of a key names who last changed it
ord: 14
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1ac92-4569-7c5f-8043-546eecf34cce
sources:
  - kind: file
    ref: apps/tagma/server/src/settings/store/rows.ts
---
A notice that a setting moved — the sub-agent model list, the review policy, a capability switch, the machine delegation switch — names who moved it from the newest row of that key across the machine and project layers, carried as `Resolved.changed`. Deleting the row on a reset would leave the previous writer's row as the newest, so a thread that cleared a value would read as some earlier writer having set it. A reset therefore keeps the row with no value and with its writer and time; a row with no value contributes nothing to resolution and is never shown as a value. A reset of a row that already holds no value writes nothing.

Only the last write of each layer survives, so several writes between two steps name the last one. A change that no row records — a provider sign-in, a thread's team copy — is told without a name.
