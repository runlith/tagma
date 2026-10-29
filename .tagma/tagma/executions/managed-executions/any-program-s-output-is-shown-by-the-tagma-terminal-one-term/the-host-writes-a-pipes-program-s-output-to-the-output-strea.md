---
id: 01a15c3b-a640-7e5f-ad71-e79a3ee8615d
title: The host writes a pipes program's output to the output stream in read order; read doors accept output
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15c3b-f06d-75bf-8d1a-78697711bf3c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15c3b-48c4-7846-8c30-4f17497a5e13
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionRecord.ts
  - kind: file
    ref: packages/executions/src/protocol/record.ts
---
Spec part 1 [[497a5e13]]: a pipes execution's record holds an `output` stream — stdout and stderr in host-read order, in whole chunks; the server's read doors accept `output`.

The declaring commit first — `output` in `protocol/record.ts#Stream` and the door schemas (`viewLeases.ts`, `read_command_bytes`, `read_terminal_bytes`) for the app to build on. Then the record, reopen and host reads.
