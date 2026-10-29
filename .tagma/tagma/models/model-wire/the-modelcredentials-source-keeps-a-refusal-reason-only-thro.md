---
id: 01a0c87b-cd09-708d-9c65-5b7ea9b6ac7f
title: The ModelCredentials source keeps a refusal reason only through LLMError
ord: 27
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
  - kind: file
    ref: packages/llm/src/llm/route/auth-options.ts
  - kind: file
    ref: packages/llm/src/llm/route/auth.ts
  - kind: symbol
    ref: packages/llm/src/llm/route/auth.ts
    symbol: toLLMError
  - kind: symbol
    ref: packages/llm/src/profiles/credential.ts
    symbol: credential
---
The LLMError tag is checked; any other rejection means there is no credential and arrives as Authentication missing, keeping only the message.
