---
id: 01a0c83e-724f-78bd-bbad-d148000bfbc2
title: Build the zone for the Bedrock wire
ord: 107
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c883-772a-74b0-a3c9-9b46aa19d287",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/llm/protocols/bedrock-converse.ts
  - kind: file
    ref: packages/llm/src/llm/protocols/bedrock-event-stream.ts
---
Write the claims of [[bbc1708d]] from those two files, and the Bedrock helpers under `protocols/utils` that only this wire reads. Parent [[249ce587]], reference shape [[6c81c6f3]]. The signed request and the binary frame format are the two things no other wire here has.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.