---
id: 01a17b56-eab7-742c-94ff-8dc245e50d9b
title: "Resize from the control plane holds input admission until the main loop answers Resized: keypresses through the endpoint wait for the main loop"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b25-1345-7ccf-82c8-ba112cc40277",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17aff-0013-783e-93b0-8217d7e0445d
  - kind: implements
    to: 01a17aff-0013-783e-93b0-8215dc3c916a
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionInput.ts
  - kind: file
    ref: packages/execution-host/src/posix/terminals.worker.ts
---
`ExecutionInput.admit` holds one `admitting` permit for acts of all lanes, while resize holds it through `sink.resize`. In the terminal stream `terminalSink.resize` after ioctl asks the main loop with `Resized` (record grid, interpreter). If the main loop freezes after resize is sent and before the answer, every keypress through the endpoint waits for it — exactly what [[dc3c916a]] forbids ("neither a synchronous stall of the main loops delays a keypress"). The endpoint itest with resize in flight doesn't catch this. Decide how the resize verdict stops depending on the main loop, or how admitting other acts stops waiting for resize, while keeping single-lane sequence order and the resize receipt's meaning. Found by the [[d7e0445d]] review.
