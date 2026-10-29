---
id: 01a1239c-e5b6-7516-a6bb-2e9efefded8c
title: An app's schedules belong to the machine, and removing the contribution keeps its grid for the next enable
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/schedule/layer.ts
  - kind: file
    ref: apps/tagma/server/src/schedule/receiving.ts
  - kind: file
    ref: apps/tagma/server/src/schedule/timetable.ts
---
The background process is one per machine, so a schedule does not depend on the app's project visibility. Removing the contribution immediately stops future ticks and removes the schedule from reading, but keeps the recorded grid: re-enabling or a process restart waits out the previous follower's completion and continues the grid with no period shift and no queued missed launches. When registering contributions, the schedule declares its port; composition binds it to `TagmaAppPoints` and the MCP caller, so the lowest time owner does not depend on the apps runtime.
