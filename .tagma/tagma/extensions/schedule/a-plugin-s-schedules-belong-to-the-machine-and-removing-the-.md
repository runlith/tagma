---
id: 01a1239c-e5b6-7516-a6bb-2e9efefded8c
title: A plugin's schedules belong to the machine, and removing the contribution keeps its grid for the next start
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
The plugin's process is one per machine, so a schedule does not depend on which projects run the plugin. Removing the contribution immediately stops future ticks and removes the schedule from reading, but keeps the recorded grid: running the plugin again or a rebuild that publishes it anew waits out the previous follower's completion and continues the grid with no period shift and no queued missed launches. The schedule stands while the plugin is enabled, whether its process runs or not: a tick is a demand, and opens an idle process. When registering contributions, the schedule declares its port; composition binds it to `PluginPoints` and the MCP caller, so the lowest time owner does not depend on the plugin runtime.