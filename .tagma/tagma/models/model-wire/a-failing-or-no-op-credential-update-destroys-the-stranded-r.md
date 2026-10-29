---
id: 01a0c8cb-0492-7875-a673-8f56016d6004
title: A failing or no-op credential update destroys the stranded rotation it was meant to save
ord: 45
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/llm/src/oauth/CredentialFile.ts
    symbol: update
---
`CredentialFile.update` calls `snapshot()`, which reconciles and DELETES every stranded temporary, and then uses only `.value` — so a change that fails, or answers the document it was handed, leaves the adopted credential deleted and nothing written in its place. Adoption exists to save a rotated credential a crash stranded; this path destroys it instead.

Beside it: `0o600` is a creation mode only, so the write follows a symlink and keeps an existing file's mode on a pre-existing `<store>.<pid>.tmp`; and what counts as this store's temporary is the name alone, whoever wrote it. Claimed as [[7c285e3d]] and [[387e4361]].