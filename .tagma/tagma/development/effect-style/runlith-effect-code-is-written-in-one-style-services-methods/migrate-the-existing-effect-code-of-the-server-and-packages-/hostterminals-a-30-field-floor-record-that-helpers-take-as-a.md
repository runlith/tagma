---
id: 01a13d06-539b-7fa6-b738-157a93e5aa01
title: "HostTerminals: a ~30-field floor record that helpers take as a self parameter is split by subjects"
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae5-73b8-9762-d6fecee64610",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13c96-169f-74aa-b870-a2c1bf2f78b7
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/acts.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/hostTerminals.ts
---
In the executions migration the `HostTerminals` class became the `HostFloor` record (`executions/terminals/hostTerminals.ts`): about 30 fields — services, rows, queues, PubSub, Map, helpers. Helpers in neighbouring files (`commands/acts.ts`, start, reads, input, custody, stops) take it as a `self: HostTerminals` parameter and read through `self.units`, `self.intents`… That is a class shape under another name: no helper says what it needs, and the record grows with every new dependency.

Done: each touched subject's make takes full tags itself through `yield*`, state and watcher lifetimes stay with owners; HostFloor and the self parameters are gone, the shared HostTerminals only links the public subjects' implementations. The [[2fcf2221|single-subject rule]] holds, moving out TerminalEndings removed the construction cycle. Evidence is the zero current checker of both assigned paths, targeted typecheck, the hostTerminals, writers, endings, admission, readback and real host boot checks, one worked-through independent review. Previous spans' names, parents and attributes preserved. A full process-heavy system run is unproven within fan-out 3; that verification boundary is explicitly kept in the [[88ce8e39|migration delivery]].
