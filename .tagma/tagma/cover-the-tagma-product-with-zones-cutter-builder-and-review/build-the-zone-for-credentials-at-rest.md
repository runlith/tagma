---
id: 01a0c83e-72be-7884-995f-4c4d7de21056
title: Build the zone for credentials at rest
ord: 123
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c865-fe70-7e7a-891a-3426850027ed",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/oauth/accountKey.ts
  - kind: file
    ref: packages/llm/src/oauth/credential.ts
  - kind: file
    ref: packages/llm/src/oauth/credentialDocument.ts
  - kind: file
    ref: packages/llm/src/oauth/CredentialFile.ts
  - kind: file
    ref: packages/llm/src/oauth/fileFacts.ts
  - kind: file
    ref: packages/llm/src/oauth/fileLock.ts
  - kind: file
    ref: packages/llm/src/oauth/FileTokenStore.ts
  - kind: file
    ref: packages/llm/src/oauth/refreshers.ts
  - kind: file
    ref: packages/llm/src/oauth/storeFailure.ts
  - kind: file
    ref: packages/llm/src/oauth/vendorTokens.ts
---
Write the claims of [[0909b860]] from those ten files. Parent [[249ce587]], reference shape [[6c81c6f3]]. What the lock actually guarantees between two processes and what it does not, what the refresh buffer buys, and why a stored credential's shape is the vendor's rather than a superset every vendor could pass.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.