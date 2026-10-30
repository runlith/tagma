---
id: 01a0c87b-cd09-708d-9c65-5b7ea9b6ac7f
title: A ModelCredentials rejection keeps its reason only when it is an LLMError
ord: 27
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/llm/src/profiles/credential.ts
    symbol: credential
---
Any other rejection means there is no credential: it arrives as Authentication `missing` and keeps only the message.