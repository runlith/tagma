---
id: 01a0c717-a237-76e9-957d-dec2ab09a4ae
title: Refuse a custody act — take, transfer, release — presented through an inject binding
ord: 53
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c705-c818-77dd-bac1-d93e39f511b4
sources:
  - kind: file
    ref: packages/execution-host/src/Execution.ts
  - kind: symbol
    ref: packages/execution-host/src/ExecutionCustody.ts
    symbol: ExecutionCustody
---
`ExecutionCustody.decide` (`packages/execution-host/src/ExecutionCustody.ts`) admits `Take` and `Transfer` on the presenting principal being the holder and never reads `binding.kind`; `admits` checks the kind on the input road alone, and `ControlBindings.authorize` matches epoch and principal without the kind. `Execution.admitCustody` hands the authorized binding straight to `accept`. The product opens exactly such a binding under the execution's holder (`apps/tagma/server/src/harness/HarnessLanes.ts`, `openBinding(principal, {kind: 'inject', …})`), so a server typing into a harness CLI under the operator's custody can take control and fence the operator's own controller — a violation of the rule this task was discovered from.

Fix at the owner: `decide` refuses every custody act when `binding.kind === 'inject'`, with a refusal that names the kind, so the comment above `admits` ("accept never sees one") becomes true by construction. Done when a conformance test opens an inject binding under the holder, presents each of the three acts, and every one is refused; the server's own lanes keep typing.