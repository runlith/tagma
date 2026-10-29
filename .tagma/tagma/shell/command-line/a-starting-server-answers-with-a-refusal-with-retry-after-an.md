---
id: 01a1427f-5810-7f2b-a411-afefdb6732e6
title: A starting server answers with a refusal with retry-after, and the client door waits out its answer for all its clients
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14274-9f8b-7125-818c-5dddc226e611
sources:
  - kind: file
    ref: apps/tagma/server/src/cli/door.ts
  - kind: file
    ref: apps/tagma/server/src/cli/verbs/mcpServe.ts
  - kind: file
    ref: apps/tagma/server/src/http/starting.ts
---
While the server opens its stores, its early handler (`http/starting.ts`) answers every operation with 503 `server-starting`, with a `tagma-outcome: refusal` and `retry-after: 1`. All its clients reach the server through the `ask` of the client door (`cli/door.ts`): the `tagma` verbs, the `mcp-serve` bridge of terminal CLIs, and the Claude runner on `acp`. So the promise to answer is kept here, once for everyone. A refusal with `retry-after` never reaches the caller: the door waits the named time and asks again until the answer changes, writing once to stderr that the call is waiting. The refusal reached the request before the operation ran, so the retry is safe even for a writing operation. The wait also ends when the caller has gone: the `mcp-serve` bridge hands the door the MCP request's cancel signal (`CallerSignal`), and the next attempt never goes out — the caller gets the refusal itself. Otherwise a CLI that dropped the call on its own timeout would have had it executed after startup, and a model retry would have run it twice.

An announced 5xx the API did not declare is tagged by the server with `tagma-outcome`. One tagged `refusal` stays a refusal with a body: its code is read by `refusalOf`, and the CLI exits with the refusal's code. One tagged `defect` becomes an `Error` with the failure's words. The startup refusal used to become an `Error` too. The runner took it for a server failure with unknown outcome, the model got a false error and repeated the call with a new id, and the first call stood in the feed as `queued` until the end of the turn.

Silence from the server (`ECONNREFUSED`) is not waited out by the door: it cannot tell a restart from a server that is not there, and a CLI verb with no server must refuse, not hang. The runner waits out silence itself ([[d0810682|Claude runner]]): its process lives only while the run holds the server.
