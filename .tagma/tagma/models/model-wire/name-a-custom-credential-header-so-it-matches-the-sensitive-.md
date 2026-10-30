---
id: 01a0c87b-cd0d-7317-b08f-a490ec949b95
title: Name a custom credential header so it matches the sensitive-name list
ord: 28
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
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
Failure reports scrub the values of `authorization`, `x-api-key` and names in the token, secret, credential and signature families; a credential under any other name goes into the report verbatim.