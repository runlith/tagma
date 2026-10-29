---
id: 01a16496-b2aa-7ff4-ab66-22b50b0076e1
title: "Fix TS4023 at ENFORCEMENT_PAIRS: the export exposes the private bodyTag"
ord: 71
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16496-f14f-79b5-b786-ffcb0e94fa38",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16472-6102-7eea-b3b2-337e6b694470
---
`bun run typecheck` of the server on 5,435 files left one refusal after the OpenCode fixes: operationBodies.ts(316,14) TS4023, ENFORCEMENT_PAIRS exports the private bodyTag from platform/contract/service/body. Remove the inferred-type leak at its owner, keeping the strict generic needs of operations and unchanged behaviour; typecheck is the proof, a ceremonial runtime test is not needed.
