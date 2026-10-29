---
id: 01a11401-0fc2-7ae2-9e45-3dab1b0cec2e
title: "Rebuild the ACP driver by owners: request id from the client machine, extension declarations, one wait, one row-change road, a fake agent with _tagma/*"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11416-b47b-763c-813a-43511cc97f05",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a113ff-0d62-74ec-ae7c-e91316a4c8ac
  - kind: waits-on
    to: 01a11401-0fc2-7ae2-9e45-3daa8e42577c
---
Do everything spec [[16a4c8ac|owner-built driver]] describes, in `apps/tagma/server/src/external-harnesses/protocol` and `packages/acp/src/client.ts`. Behavior unchanged.

Done when today's protocol system tests pass with assertions unchanged, the fake agent `testing/acpAgent.ts` covers every `_tagma/*` road, the code search from the “Verification” section is clean, and notes e47bd3fc, 92391518, f3949b43 are rewritten.
