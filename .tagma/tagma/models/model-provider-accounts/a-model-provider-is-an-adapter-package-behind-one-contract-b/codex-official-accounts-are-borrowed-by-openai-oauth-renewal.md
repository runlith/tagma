---
id: 01a12f52-1ad3-7c7f-aebb-baf89e295f9b
title: Codex official accounts are borrowed by openai-oauth, renewal through codex; 401 and refresh waiting per spec
ord: 10
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
---
Gaps from spec-audit №11, №12, №16. `openai-oauth` does not declare `borrows` (`packages/adapter-openai/src/adapter.ts`), and Codex has no renew command (`adapter-openai/src/accounts.ts`), so "Codex" accounts do not work on their own path. Renewal waits up to 60 s (`credentials/borrowed.ts`) — longer than one provider request.

Done: `openai-oauth` takes signed "Codex" accounts from the directory's `auth.json`; on 401 with the previous token, `codex` starts in the account directory and the token is re-read; renewal waiting is bounded by the provider request timeout. Tests through the owner's public operations.
