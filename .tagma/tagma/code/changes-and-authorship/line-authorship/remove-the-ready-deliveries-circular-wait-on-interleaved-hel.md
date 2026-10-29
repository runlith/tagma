---
id: 01a1648e-e31e-7fe1-8c00-cc2960c5a414
title: Remove the ready deliveries' circular wait on interleaved held lines
ord: 56
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16493-90ec-7d84-8fd8-6fdd4d63d127",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16445-90f3-7a0d-9973-f138f314fb57
  - kind: discovered-from
    to: 01a16487-9741-727f-8ed9-9973d2548c8d
---
Fix building the change and the commit tree so the lead's ready work and completed children land without waiting on an idle peer's held lines and without a separate word from the operator, preserving authorship and never capturing unfinished foreign integration. Reproduce the interleaved account/ModelChanges held lines of the new test and the independent Cursor/OpenCode additions in shared declarations; rules, formatting, hooks, and foreign working files are not bypassed.

Landing picks separate splices, not whole diff regions or records: a file-creation dependency points at the creator, an insertion edit keeps its author, independent appends and a second splice of the same record stay out. Retirement keeps the record until its last held part is gone. Dependencies judge as the calling delivery; `whole` is set by paths, idle `taking` needs no extra word. A cross-file unit is set explicitly through `paths`/`taking`, as agreed in the spec. The contract and its boundary are written in [[0c6f0a9e|the line-picking explanation]].

Native `submit_work` is reproduced red→green in its own stand: a two-author new account file lands, a third independent author and unfinished declarations stay held. Two P1 and two documentation findings of one Sol review xhigh were confirmed and fixed; the P1 regressions passed red→green, and the partial-write remainder lands on the next call. The final typecheck is green; 63 picking, attribution, retirement, and gated-rule checks passed; 19 enforced rules found no violations. The commit passed the regular shape steps and hooks. The operator's working server was never updated: the new semantics were verified on sources, the installed door stays until the human updates it as routine.
