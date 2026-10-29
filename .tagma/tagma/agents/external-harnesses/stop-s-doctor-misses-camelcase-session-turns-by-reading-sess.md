---
id: 01a0caeb-95fa-7241-b7aa-9ebc08c2587f
title: Stop's doctor misses camelCase-session turns by reading `session_id` alone
ord: 156
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
---
Stop's doctor reads `event.session_id` alone when resolving the turn's touch account, while every other road keys marks through `sessionIdOf`, which reads both spellings. A turn whose vendor emits camelCase `sessionId` therefore resolves no account: its debt is never shown and the follow-up carries nothing.

Done when the doctor keys marks the way every other road does — through `sessionIdOf` — proved by a test stopping a turn that spells the id camelCase.