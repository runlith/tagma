---
id: 01a0c3c3-5cae-7cce-af4b-00c64ef45bc7
title: Observe and control every agent invocation through one realtime lifecycle
ord: 185
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
The operator must observe every agent tool invocation from preparation through final settlement, including supporting executions, through a WebSocket snapshot and event stream. An internal purpose describes work; it does not exclude work from observation. Short calls remain discoverable after completion. Both the thread transcript and sidebar address the same call and expose its applicable controls.

Stopping one invocation cancels its own work and owned processes without cancelling its run or unrelated calls. The model receives an operator-stopped outcome and may continue. Moving an already-running invocation to background releases the model's wait without restarting or cancelling the work. The operator can do this from either surface, and the agent has the same operation. Completion remains observable and its result reaches the originating thread. Time limits belong to the lifecycle owner, remain adjustable while work is pending, and report actual cancellation/cleanup rather than pretending that abandoning a wait ended an effect.

The agent runtime owns call identity, execution lifetime, cancellation and foreground/background settlement. Tagma owns project authorization, durable thread delivery and its WebSocket projection. The execution host owns native process identity and termination evidence. The UI projects these owners and forwards intent. Existing replay, inbox, execution and transport mechanisms must be extended rather than shadowed by polling or a second process launcher.

Short-call latency is measured end to end, not only over child runtime. The managed admission path must query actual incompatible resource uses without materializing compatible holdings. Supporting checkout measurements remain attributable and managed; their lifecycle overhead is repaired at admission rather than bypassed. Acceptance includes isolated cancellation with concurrent sibling work, background conversion before and during execution, late completion after the run ends, reconnect without lost short calls, and measured admission behavior with thousands of compatible holdings. No browser interaction is authorized for this work.