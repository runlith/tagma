---
id: 01a0f4ab-e311-7a99-af0d-be9c544301b1
title: Program contract 2 with runner descriptors and binding keys, and one run per checker identity
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f560-f84d-77cb-9e98-b46a404c2a47",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-04de-7739-9ff5-ba99d11108eb
  - kind: waits-on
    to: 01a0f4ab-e2d9-7636-853c-1febcec43670
  - kind: waits-on
    to: 01a0f4ab-e305-70d0-b091-90015a470ad3
---
Build program contract 2, runner descriptors in `runners.json` of the project's programs directory, and one run per checker identity per judged tree ([[d11108eb]] §4.1–4.3).

**Class:** complex — `gpt-6-astra` high, implementing under the operator's revised model policy.

**Target:** descriptors `{ id, adapter, argv | config, layout, pins, packages, runtime }`; a policy's check bindings `{ runner, id, params?, files? }` (version 2 policy, [[172759d0]]); invocation-local binding keys `{ key, id, params, reach }`; input with `request` and `checker`, output echoing `contract, request, tree, base, checker` and `run.capabilities`; exactly one reading per key and side, else `inspection-failed`; `covered` as a path list or `{ scope: "reach" }`; grouping of every binding in play by checker identity so one process serves all; contract 1 programs keep running.

**File scope:** `apps/tagma/server/src/enforcement/contract/wire/program.ts`, `enforcement/programs/**`, `enforcement/judging/judge.ts` (the loop that groups), `enforcement/settings.ts` (the descriptor file's place); `@tagma/inspection` for the contract's schemas if shared with builtins.

**Acceptance:** [[d11108eb]] §7 items on ten norms and one process, distinct readings for two parameterizations, missing/duplicate/mismatched echo refused; a contract 1 program still judges; typecheck; tests.

**Waits on:** the codec task (check bindings in the version 2 policy), the counts task.

**Reviewers:** Muse xhigh lenses (contract compatibility; performance — one process per group) and Sol high general review. A critical gate-safety finding may additionally require Opus xhigh; the implementer does not review its own work.
