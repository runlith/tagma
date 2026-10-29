---
id: 01a14292-4088-7409-8163-c1d047e3ca6b
title: A hosted-thread turn-open retry answers from the record, and the runner rides out a broken open request
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14274-9f8b-7125-818c-5dddc226e611
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code/door.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadHosting.ts
---
`open_hosted_turn` does not answer a retry from the record. `ThreadHosting.open` recomputes the turn context on every call, commits it together with the graph cursor and world-snapshot shift, records the step guidance, and advances `hosted.step`. If the server committed the open but the answer never reached the runner (a restart mid-request), a retry on the new server sees the context as already delivered and answers empty or with a delta. The model never receives the first opening's context, while the journal counts it as delivered.

So the runner (`ServerDoor`) retries an open only on connection refusal and `run-not-held`, and a request broken off mid-flight ends the prompt failed ([[d0810682|Claude runner]]). A turn whose server restarted mid-open breaks visibly.

What to do: a turn open answers a retry of the same open from the record, like `call_hosted_tool` (`hostedReplay`). The runner passes the open id (the prompt uuid, which is also the Tagma turn id); when the server finds that open's recorded context and guidance, it answers with their text and writes nothing again. After that `ServerDoor` retries the open even after a broken request.

Proof: a hosting test — the first open recorded, the answer lost, a retry with the same id answers with the same text and adds no records; a `ServerDoor` test — an open rides out a broken request.
