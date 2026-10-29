---
id: 01a16e46-3e0f-7744-bda6-af25f1e9044e
title: "Cut the cost of the remaining threads-transport tests: protocol (transport, handover, order, configure, cursor), hosted reveals/accounts, opencode"
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dec-fbf8-7898-a8a7-e83233ac9f35",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Untouched part of the threads-transport package (about 66 s CPU per measurement 08f81bea): `composition/testing/threads/{protocolTransport,protocolHandover,protocolOrder,hostedReveals,protocolConfigure,protocolCursor,hostedAccounts}.itest.ts`, `external-harnesses/runner/opencode/sdk.itest.ts`, `external-harnesses/vendors/opencode/plugin.itest.ts`, `external-harnesses/birth/installed.itest.ts`. Each file gets one outcome — removal, unit, merge, or a narrow itest. The rest of the package is held by x-transport-a and x-transport-b.

Result: by agreement with x-transport-b, `protocolTransport`, `protocolOrder` and `protocolConfigure` stayed with x-transport-b, and `hostedAccounts` with x-transport-a, which holds its edit. `protocolCursor` removed (5.7 s → 0, 48ebec5e07): its contract is proved by `providers/accounts/harnessAccounts.itest.ts` › "a key harness launches with the pinned key instead of the default…". `protocolHandover`, `hostedReveals`, both opencode files and `birth/installed` are kept: they are the only end-to-end or conformance proofs of their paths, and their cost is vendor processes and the shared world.
