---
id: 01a10284-da13-7e0c-9742-a4294316f802
title: Telemetry attributes SQL queries, command costs, and trace moments, while retained spans hold no values
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e81-7d00-9d11-fe1e2fd37a26",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/worlds/shell/results.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/performance.ts
  - kind: file
    ref: packages/agent/src/agent/AgentToolDoor.ts
  - kind: file
    ref: packages/performance/src/PerformanceTracer.ts
  - kind: file
    ref: packages/performance/src/TraceSampler.ts
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/trace-bundle/src/TraceBundles.ts
---
**What.** Telemetry attributes SQL queries, command costs, and trace moments, while retained spans hold no values. Without this the other perf fixes can be neither found precisely nor verified.

**Why and where (perf audit 2026-10-03).**
1. `sql.execute` carries only `db.operation.name`: no query fingerprint, no queue/exec child, though `packages/sqlite-process/src/connection.ts` knows `StatementTiming`. A 6-second `sql.execute` in `ThreadFeeds.open` could only be identified via serve.log.
2. `SampledSpan` (`packages/performance/src/PerformanceTracer.ts:296-315`, `TraceSampler.ts`) holds the full success Exit with the value — `sql.execute` rows, BlockDetail, the model answer — until the unit settles; `byteSize` does not count it. Before the server's self-restart 2026-10-03 15:45:57Z: heapUsed 3.0–3.8 GB, external 2.9–3.7 GB, RSS up to 7.4 GB (growth cause not established).
3. `packages/trace-bundle/src/TraceBundles.ts:150-220` stamps `record.at` on async drain, not on emission: started/executing/ended deltas in trace are queue lag. `packages/agent/src/agent/AgentToolDoor.ts:1108-1135` counts `durationMs` before the awaited `afterTool`.
4. `executions/worlds/shell/results.ts:186-225` unconditionally yields `cost=Unmeasured`, though the host (`packages/execution-host/src/native/PipeChild.ts:203-215`) knows wait4 cpuMicros/peakRss: `read_performance(commands)` does not rank command classes.
5. The `native-harness/skills/performance.ts` skill names the `ThreadChannel.open` span — now `ThreadFeeds.open`; tool-call phases are not derivable from trace-bundle `record.at`.

**Direction.** `sql.execute` gets statement fingerprint and execMs/queueMs; SampledSpan stores the exit's tag and reasons without the value; the event moment is fixed on emission, write lag — separately; `durationMs` covers afterTool; command cost travels from the reaped result to the report; the skill fixed in its own source.

**Done when.** A slow `sql.execute` in `slow`/`breakdown` names its query and splits queue and exec; a retained span holds no rows; `read_performance(commands)` shows measured CPU and RSS; tool-call times in trace match event moments.
