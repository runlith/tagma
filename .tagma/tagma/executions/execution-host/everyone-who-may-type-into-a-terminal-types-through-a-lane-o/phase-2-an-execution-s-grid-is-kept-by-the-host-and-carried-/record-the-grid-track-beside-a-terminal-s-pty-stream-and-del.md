---
id: 01a0cf56-2ad8-7e4e-8344-fd81271ce57d
title: Record the grid track beside a terminal's pty stream and deliver it with the bytes
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d0f4-6c35-738b-b09d-61fcab06b856",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf56-2827-7f36-a2d4-6c54da58f62e
---
Build the host record part of [[da58f62e]] (section 5) in `packages/executions` (format and protocol) and `packages/execution-host` (the writer at `ExecutionInput`'s applied resize, and the readers). It raises `WIRE_VERSION` and moves the record format, so it lands through a restart while no execution is live. Done when the host's record suite cases of section 7 pass, a reviewer on the builder's own rung found nothing left open, and doctor over the touched paths is clean.