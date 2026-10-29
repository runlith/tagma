---
id: 01a0d4e7-2c17-7534-914a-98cffe743df6
title: The host's program-rule extension can lengthen a foreground command's default deadline past the longest act, and its call envelope then cuts it
ord: 52
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d4f3-17e3-7a7c-83d2-9cc74598c6a5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d4d9-1769-777b-bcda-913997ac5624
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionRegistry.ts
  - kind: symbol
    ref: packages/execution-host/src/ProgramRules.ts
    symbol: extend
---
**Why.** [[0f54a981]] bounds a foreground command at admission only. `ExecutionRegistry.ts#defaultDeadline` gives every `default`-origin command a deadline `ProgramRules.ts#extend` moves to `max(defaultMs, elapsed + left)` while a matched program runs, and a program rule's limit has no upper bound. A foreground `bash` on the default whose `tsc` matches a 30-minute program rule is extended toward 30 minutes, and the 20-minute call envelope ends the call with no answer. This predates task [[97ac5624]].

**Where to start.** The host does not know a launch is foreground. Either admission hands a foreground launch a bound the extension respects, or a foreground launch gets no extendable deadline — and in both cases a hand-off to the background (`AgentCall.background`) has to release it, which today touches nothing on the host.

**Done when** a foreground command's deadline never moves past the longest act while its call is foreground, and a background or handed-off one extends as before; tests cover both.