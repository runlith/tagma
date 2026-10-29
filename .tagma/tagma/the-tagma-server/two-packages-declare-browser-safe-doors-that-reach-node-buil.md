---
id: 01a0cb1a-9e40-70f4-aea9-fe7d51fd649e
title: Two packages declare browser-safe doors that reach Node built-ins, and the server's walk is the only thing measuring it
ord: 31
tags: ["task"]
fields:
  {
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/boundary.test.ts
  - kind: file
    ref: packages/agent/src/agent/AgentRuntimePolicy.ts
  - kind: file
    ref: packages/llm/src/llm/route/transport/verbatim.ts
---
`bun test apps/tagma/server/src/boundary.test.ts` fails "the door and the protocol tree reach no Node built-in" with ten edges, measured at HEAD: `AgentRuntimePolicy.ts -> node:crypto`, `transport/verbatim.ts -> node:http, node:https, node:stream, node:zlib`, `protocols/devin.ts -> node:crypto`, `protocols/shared.ts -> node:buffer`, `transport/connect.ts -> node:zlib`. The other seven assertions pass. The client is built from the server door's own declaration, so every module a declared entrypoint reaches is bundled and shipped to a browser.

None of the ten is an import this server writes. A declared server door opens a package door, and the built-in stands behind that door: the agent kernel declares `protocol` among its eight browser-safe doors ([[37554ef0]]) while `AgentRuntimePolicy` reaches `node:crypto`, and the model wire's transports reach four more ([[0ae02efb]] for its own door list). Each package's boundary suite passes, so the only measurement that sees this is the consumer's.

Decide where the line is and fix it at the owner: either the kernel and the wire stop calling those doors browser-safe and the server's declaration narrows to what is, or the reaching modules move behind doors that are not. Never by widening the server's entrypoint list or relaxing the assertion — that is the measure, not the defect.

Done when the suite's eight assertions pass at HEAD with no allowance added, and [[f0c9d545]] is rewritten from the code that then stands.