---
id: 01a127b4-0662-7e33-94b6-62cf120ee1fa
title: A `record_write` refusal from a hook keeps the record evidence and reports why the accounting was lost
ord: 60
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127e1-03e4-7718-add9-abc6a956d4a3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12792-0904-761c-aca9-99b5f5b5929c
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
---
In `hooks/dispatch.ts` `postToolUse` keeps pending only on Cut/Unreachable; Refused leaves the base that the next PreToolUse overwrites, and the reason never reaches the operator. Fix at the hook-record owner: keep the refused record fact with a typed reason and deliver the diagnostics with no automatic retry of a permanent refusal. Prove the record-unread → next hook scenario, where the first record's before is not lost and the refusal never becomes recorded. The outside path stays a successful outcome with no row, per the contract.
