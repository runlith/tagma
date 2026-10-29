---
id: 01a0c97b-8ea6-7d1c-baf2-0e76d70965db
title: One-shot transport arms the retry ladder by omission, so the next caller of a paid call re-arms it with nothing at the call site to read
ord: 59
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0c8cb-049a-70a4-a0b5-6a91ae1cf386
---
Found reviewing [[ae1cf386]]'s fix (`6ce0899790`).

`OneShotTransport.post` (`packages/llm/src/llm/route/transport/one-shot.ts`) calls `.execute(request, lifetime)` with no options, so the retry ladder is armed by OMISSION at the transport that owns the call. `draw` compensates from outside with a service wrapper (`drawing.ts:38-43`), which is the caller's spelling. The repo's owner-level spelling already exists: the streaming transport forwards the options for the call it owns (`packages/llm/src/llm/route/transport/http.ts:141`, `{ retry: request.model.route.retry === undefined }`).

Today `draw` is the only production caller of `post` (repo-wide grep: `drawing.ts:38`, plus tests `transport/upload.test.ts:33` and `route/wireFailure.test.ts:376`), so nothing is broken. The cost is the next caller: it re-arms the ladder with nothing at the call site to read, which is how this defect arrived.

"No retry" now has two spellings across four owners — options at `quotaRead.ts:64`, `devin.ts:150`, `http.ts:141`, and the service override at `drawing.ts:41`. This task is to make `post` accept and forward the executor's options, the way the streaming transport already does, and to move `draw`'s override to the call site — then delete the override entirely.

Not a defect to fix in `draw`: a guard standing in the caller while the owner arms by omission is exactly the shape `AGENTS.md` forbids, which is why this belongs here rather than in the drawing.