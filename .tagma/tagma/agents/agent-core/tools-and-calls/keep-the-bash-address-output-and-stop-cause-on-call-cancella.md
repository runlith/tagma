---
id: 01a14c22-2161-7a9d-95c9-2ffccdb62398
title: Keep the bash address, output, and stop cause on call cancellation
ord: 7
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c15-ebd5-7cdd-ba79-701f8829539c
  - kind: waits-on
    to: 01a13d2f-397e-77cc-90c3-6f023cd163f7
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentRunner.ts
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecution.ts
---
Fix the native ToolExecution door: cancellation returns the owner tool's read-back, the linked execution/operation, and the stop reason; large output lines do not push addresses out of the cut. AgentRunner passes the original stop cause through instead of a generic message. The observed command was stopped after 44.403 s on harness close: activity recorded "The agent harness was disposed." and host-stopping, the host confirmed the interrupt step and exit 130 with a 600 s life; the outside initiator of the harness close is not established in those entries. The door and its tests landed in a551f48cae. The cause pass-through in AgentRunner.ts and a separate AgentCancellation.test.ts remain in the working tree: submit_work refuses lines-held on the region of the package's unfinished Effect migration; others' held lines were not taken. The public regression tests went red→green, 33 door tests plus the separate cause test green; the last typecheck found no errors in 788 agent files, but the shared call fails on the missing @runlith/effect-test in four neighboring adapter packages. One independent review round of the door's owner code and tests is done with no findings; the cause test taken out after it was not re-read by a reviewer. The running server was not restarted; the reflection is unanswered until the remaining edit lands.
