---
id: 01a1941f-f2bb-77f3-9717-65530dcb1f38
title: Identify and remove avoidable runtime work behind narrow-check starvation
ord: 48
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd94-70a8-8803-d52933fdfb4c",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a13fbb-68e2-7b63-b559-c6ffde3c8217
---
Establish causation for narrow-check starvation before changing runtime cost. The historical timeout remains unattributed, and no setting, guard, deadline or runtime policy was changed.

The original observation is thread `01a13f2e-523d-71cd-acb6-4295df9398b1`, entries 3150 and 3159, at 2026-10-15T13:22:49.627Z and 13:23:29.477Z. Its server was pid 17868 from installation `20261015T121751750Z`; the machine reading reported all machine cores busy, Tagma share 62.8%, server share 54.0%, Tagma RSS 7.39 GB and normal memory pressure. The narrow typecheck was `bun check --threads=1 -p apps/tagma/server/tsconfig.json` with a 180-second command life. The graph tests had then-current ten-second limits. The reading was after the caller's own commands, not a synchronized observation of their resource waits. A previous investigation on the same day also left causation unproved while observing only 0.1–0.7 server cores. Current telemetry retains nothing before 2026-10-30, so the old serving-loop profile and overlap cannot be recovered.

On 2026-10-31 the current server was pid 31614, installation `20261031T175000144Z`, telemetry instance `d7e70846-6065-413c-9019-865b4aac219b`. One current machine sample was 83.9% busy with warning memory pressure and Tagma 54.9%; a later sample was 75.1% busy with Tagma 38.3%. These are live samples of a different build and workload, not a counterfactual for the old failure. The faithful activity-window seed-3 fixture exited 0 in 17.05 s wall / 10.4 s CPU. The original named graph-queue file was also attempted once through current testbed admission: execution `422501bc-615f-4d94-99b4-f14a455718cd:167`, variant seed 738391120, exited 1 with 0 pass / 4 fail in 8.32 s wall / 3.4 s CPU. Its failure was `Error: a second writer registered for mcp.servers`, not a time limit. That fixture defect was handed to the graph lane; it prevents treating the probe as a successful latency comparison.

There is a separate measured current serving-loop cost: retained stall `3685da6b-4bc4-4ab2-ac84-488fc2667f28`, wallTime 1793486113890, delay 1278 ms, had 1021.4 ms loop-thread CPU over a 1303.0 ms interval. Profile `5d54b837-9182-4da7-9dab-fe34dcb0d3f6` captured 1031 in-stall samples / 1266.6 ms in Bun `internal:serialization_buffers::tagBuffers`; the raw caller stack is `sqlite-process/children.ts:send` → `ProcessPool.send` → `connection.ts:sent`. This identifies computation in the current IPC boundary, but does not identify the message payload, establish an avoidable producer defect or explain the old checks. The evidence was passed to the persistence lane, which owns lower SQLite-process producer fixes. No second capture or instrumentation feature was added.

An independent config-lane fixture reported a current green seed slowing from 26.4 s file wall to 190.1 s, with SQLite writer/git-index hold warnings and 31.2 s uncovered test wall; that report is another waiting/contention candidate, not a proved server-CPU effect. Retained load queries for that execution and the machine returned no rows, which is missing coverage rather than zero load. A causal fix still needs an isolated current workload and identified resource/producer; disabling shared runtime work or raising limits would not supply that proof.