---
id: 01a0e532-ca86-7457-9b1b-3d5ffc18065e
title: "graph M3: closed"
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-ca7c-7f96-97dd-247ba9fd89de
---
§7.2.2 milestone `M3` of the `graph` card ([[f7e0b9dd]]), with its vocabulary amendment [[8950b1dd]].

Final checks at 951310b733 over `graph/` (316 files):
- `names`: 0 new.
- Unit tests: 155 pass. The 2 failures are load errors in `orientation/sessionStart`.
- Typecheck and `modules` fail only on imports into files peers are moving now: `sessionStart*` → `external-harnesses/{contract/service/adapter,adapter/hookFormat}`, and `measure/checks/structure.ts`, `orientation/law.ts`, `work/enforcement.itest.ts` → `enforcement/contract/service/enforcedLaw`. These resolve at integration.