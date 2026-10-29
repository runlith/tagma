---
id: 01a13f63-559c-7cb3-89b6-c44b6b237a7d
title: "MCP-root and self-observation reflections: scratch outside roots in Chrome, unbounded answers, empty metrics"
ord: 123
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f64-c07b-7c98-8268-8eb098a0a772",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/door/AgentToolDoor.ts
  - kind: file
    ref: packages/mcp/src/McpRoots.ts
  - kind: file
    ref: packages/performance/src/MetricSnapshots.ts
  - kind: file
    ref: packages/performance/src/protocol/queries.ts
  - kind: file
    ref: packages/sqlite-process/src/Checkpoints.ts
---
Fix the refusal roots of Chrome writing to scratch, heavy performance answers, empty metrics, false activity success, and fatal SQLITE_LOCKED. API and contract changes are allowed by the operator; the proof is contract tests, one review round, landed changes, and an answer to each reflection.

## Landed: 789fda56bc

[[1b1faa6b|Activity]] records the ToolVerdict: refused keeps code/reason, cancelled becomes cancelled, unknown becomes failed. For [[8efbd666|heavy pages]] slow/overview are capped at 57/20 rows by measured pretty-JSON; total is the exact count when the first page reads fully, otherwise null. [[06378a12|Calibration]] applies to these two families; the rest are a [[4f21f5d8|separate task]]. Agent/performance tests and typechecks passed, Sol and two Muse xhigh review rounds. The performer landing refused: [[cf08200a|landing-busy]], [[680193dd|InterruptError]]; the parent landed the changes.

## Second delivery

- [[1e67498f|Chrome screenshots]], [[11ab143e|retry from checkout]], and [[a580d3ac|Chrome network files]]: MCP declares the roots capability, serves roots/list, and publishes the union of active calls' checkout/scratch. Parallel leases hold the shared root until the last release; idle threads do not accumulate in the session. A real MCP peer confirmed parallel writes to different scratches, holding the shared checkout past the end of a neighbouring call, and refusal after the last release. Peers requesting roots only inside tools/call are supported: the client does not wait for a nonexistent ACK notification. The post-release notification belongs to the session scope and does not delay a known outcome; the HTTP test keeps the answer on a 500 to the notification and checks the next call after recovery. Best-effort recovery has an exact allowance in the failure-handling rule.
- [[47835745|SQLITE_LOCKED]]: the service checkpoint error is carried whole; BUSY/LOCKED go to the existing deferred pass, other errors and a lost checkpoint child stay fatal. A real-WAL-database contract test confirmed LOCKED from an unread SELECT iterator, no false loss, WAL copying after the iterator closes, and a preserved IOERR. BUSY from an exclusive connection additionally passed a real child IPC; after the connection released, the serving process finished the deferred checkpoint without losing the store. The original bench held an EXPLAIN the author deleted before landing; moving to readOnly kept taking the writer db. In the current child, Run reads all()/values() to the end; the engine check and a read-through EXPLAIN in the test hold no lock. The concrete statement of the historic incident is undetermined; the classification fix is not declared a fix of an unproved leak.
- [[8ccce3ab|Empty metrics]]: the lost first completions were reproduced — the first cumulative snapshot became the baseline. Registry now writes a zero origin together with the name's first snapshot, in one retention group; one completion before the first tick counts into metrics. Overview explicitly answers no-snapshots-in-interval for an empty window. The old 9.9 s window may hold no ticks; its source snapshots are not preserved, so that case's causality is not proved.

Package typechecks for MCP, performance, and sqlite-process passed; the last MCP typecheck includes the fixed HTTP fixture and SQLite test. MetricOrigin/MetricSnapshots — 4 pass/19 asserts; paging/schema — 3 pass/20 asserts; checkpoint — 2 pass/18 asserts, blocked — 1 pass/13 asserts; roots — 2 pass/18 asserts. A separate server typecheck stopped on someone else's generatedConfig.itest.ts:70: readonly string[] has no sort. One review round: Sol xhigh and three Muse xhigh; confirmed and fixed the cyclic wait on roots/list, the lost known result on release, the unconfirmed-answer map hold, and the IPC-check gap for SQLite. No repeat review ran. The second delivery landed in 8955c75cb6; all its rows were handed over, the working server was not restarted.
