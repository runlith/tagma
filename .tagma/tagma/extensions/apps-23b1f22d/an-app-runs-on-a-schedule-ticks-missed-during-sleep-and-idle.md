---
id: 01a14c08-8336-7b3c-965a-b09ba9522c13
title: "An app runs on a schedule: ticks missed during sleep and idle time do not pile up, they yield one run"
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09415a61526
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/ticks.ts
  - kind: file
    ref: apps/tagma/server/src/schedule/contract/wire/schedule.ts
  - kind: file
    ref: apps/tagma/server/src/schedule/timetable.ts
---
**Value.** A bridge to an external service polls it on its own, on time, with no agent and no open window.

**How.** The manifest's `schedule` point names schedules: name, period, and the process tool that receives the tick. State is read by `read_schedules`.

**Behaviour.**
- One run at a time per schedule. Ticks that passed while a run was in flight, the machine slept, or the server was down do not pile up: a single run goes instead, and the tick says how many slots were missed. A run longer than the period does not chain onto itself.
- A tool answer with an error is recorded as the run's result; there is no off-grid retry. A run interrupted by a server stop starts over after the start.
- A schedule belongs to the machine and does not depend on which projects the app is enabled in; disabling the app stops ticks, and re-enabling continues the same grid.
- A schedule does not keep the machine awake.

**Limits.** Only apps declare schedules. `read_schedules` is operator-only; the window has no schedules screen: they can be seen via `tagma op` or HTTP.
