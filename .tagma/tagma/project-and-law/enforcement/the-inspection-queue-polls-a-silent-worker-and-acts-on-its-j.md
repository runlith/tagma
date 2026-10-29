---
id: 01a122f7-8f1b-7b82-bce4-24c785a257f0
title: The inspection queue polls a silent worker and acts on its journal instead of waiting blindly for an answer
ord: 26
tags: ["task"]
fields:
  {
    "holder": "tagma:01a122bd-84ed-7d7f-8953-10fb863f721a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1205b-eb84-7eac-af15-ef0da2afe539
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspecting.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspectionLanes.ts
---
**What.** `once` in `inspectionLanes.ts` waits for a worker answer without end: a lost request, a lost answer or a lost event inside the worker holds the queue and every commit whose rules landed in it (the October 9 case in [[a2afe539]]). A queue whose request went quiet periodically asks the worker for state; the worker keeps a journal — the last received request, the last sent answer, launched processes with seen exit and in-system state, unfinished parse and load waits — and the queue acts on the answer: request didn't arrive — sends it again; answer lost — takes it from the state; waiting on a process exit that is already gone from the system or a zombie, with no movement two polls in a row — a refusal with evidence and one retry in a fresh worker. A working worker is waited for as long as it takes: time only decides when to ask. With no movement the journal goes to the log.

**Done when.** Queue tests on fake workers: a lost request, a lost answer and waiting on a vanished process's exit all end with an answer; enforcement typecheck and tests green.
