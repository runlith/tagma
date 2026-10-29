---
id: 01a0c87b-cd0d-7317-b08f-a490ec949b95
title: A credential under a custom header comes only from the sensitive-name list
ord: 28
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
    symbol: header
  - kind: symbol
    ref: packages/llm/src/llm/route/executor.ts
    symbol: secretValues
  - kind: symbol
    ref: packages/llm/src/redact.ts
    symbol: isSensitiveName
---
Names for scrub are authorization, x-api-key and the token, secret, credential, signature families; any other name sends the value into the failure report verbatim.
