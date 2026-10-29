---
id: 01a0c83e-7248-7daf-8c8f-0d615d4c213f
title: Build the zone for the OpenAI wires
ord: 106
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c85d-a5e4-7f85-b7b7-f323489e9833",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/llm/protocols/openai-chat.ts
  - kind: file
    ref: packages/llm/src/llm/protocols/openai-compatible-chat.ts
  - kind: file
    ref: packages/llm/src/llm/protocols/openai-responses.ts
---
Write the claims of [[40d434fe]] from those three files. Parent [[249ce587]], reference shape [[6c81c6f3]]. What the compatible-chat variant assumes about a vendor that copied Chat Completions, and where Responses and Chat genuinely differ rather than merely spell differently.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.