---
id: 01a1ad6e-1f40-7554-b22f-4d857343e13d
title: A thread row marks the transport, authority and capabilities that did not read, and every reader acts on that mark
ord: 166
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1ace6-ac33-7441-95c2-f95171c4f1f1",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a15208-9958-790e-b6dd-4de6a15337e5
  - kind: relates
    to: 01a1ad42-04ef-744c-89dc-278436fdc3f7
sources:
  - kind: file
    ref: packages/agent/src/thread/record.ts
  - kind: file
    ref: packages/agent/src/thread/persisted.ts
---
The safe stand-ins for a stored fact that does not read (`UNREAD_BINDING`, `UNREAD_CAPABILITIES`, authority as review) were indistinguishable from real values: `set_thread_transport` read an unread binding as terminal and answered `unchanged`, released through `orDie` and died, `harnessTransportOf` reported acp, `TransportCannot` claimed the transport declares no capability, and the launch refusal named the stand-in adapter. The reading now sets a typed `unread` mark beside the values on the row, the harness road and the binding read, and every reader acts on it: the transport registry refuses typed, `set_thread_transport` writes the asked road and refuses a held process, the CLI row names no road, `TransportCannot` says the capabilities did not read, and the snapshot carries the mark.