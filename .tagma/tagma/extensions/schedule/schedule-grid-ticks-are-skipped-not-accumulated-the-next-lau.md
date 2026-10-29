---
id: 01a1233d-06d1-770c-b32a-87be3ed583f4
title: "Schedule grid ticks are skipped, not accumulated: the next launch is the first grid node after the current one's end"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/schedule/timetable.ts
---
The schedule stands on a grid: nodes are `nextAt + k·everyMs` from the last recorded `nextAt`, not from the start moment. When a launch falls due (after sleep, a server stop, or simply in time), one launch goes; the `skipped` tick says how many nodes had already passed by its start. On completion the next `nextAt` is the first grid node strictly after the launch end, so nodes that passed while the launch ran are skipped, not deferred, and a launch longer than the period never runs back-to-back with itself. A recipient failure (`TickRefused` or a defect) is recorded as the launch outcome and shifts the grid no differently than success: no retry off the grid.

Only state and time are permanent: `nextAt` and the last launch outcome lie in `schedule_run`, while schedules themselves live in memory — the owner declares them (`declare`) at every server start, and the same `everyMs` keeps the recorded `nextAt`; a period change restarts the grid from now. A launch cut by a stop is unrecorded and goes again after the start — at-least-once delivery. Machine sleep needs no separate code: an overdue timer fires on wake, and the same computation folds the missed launches.
