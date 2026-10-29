---
id: 01a123bf-df38-77d4-bfc6-3cda183bbfe8
title: "The credential file (CredentialFile) lives in @runlith/llm but non-llm owners use it too: move to the lowest shared owner"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12395-c3c5-763e-8ec3-0b0d4647905f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12395-9b58-78c0-9bc7-fedd1f6db033
---
`plugin-secrets` stores values through `CredentialFile` from `@runlith/llm` (a 0600 file for OAuth tokens), though it has nothing to do with models; the llm card gained an entry for it. By the rule on types shared across modules, the type and mechanism go to the lowest owner both use — no copy and no alias. Done when `CredentialFile` is declared at the lower owner, `@runlith/llm` and `plugin-secrets` import it from there, the extra entry is removed, and both tests pass.
