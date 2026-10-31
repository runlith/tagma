---
id: 01a116c6-1f18-74ee-a89f-967c69003cc1
title: "The swallowed-failures inspection sees a read failure turned into absence: a Failure branch on Result/Exit/Option answering null, an empty list, or an empty Set"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a116c6-678b-7f27-b35b-696638f84bb9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1166f-7113-7752-b6b9-0a71c16f87cd
---
**Why.** #rule [[ea465bed]] stands at gate, but its inspection (`apps/tagma/inspection/src/packs/effect/swallowed-failures/`) sees only `catch`/`ignore`/`orElseSucceed` and sibling forms. `result`, `exit`, `option`, and `match` it directly calls "not sites". The main defect class in the "what the thread changed" history ([[c16f87cd]]) is `Effect.result(...)` or TextAt whose Failure branch answers absence. That is how `change-record/record/discharge.ts` `blobsAtRevision` (unreadable means "file missing at HEAD") and `prepared/subject.ts` `textOf` are written, for example.

**To do.**
- **New sites.** A failure branch on `Result`/`Exit`/`Option`/`Either` where every outcome is an absence value: `null`, `undefined`, `[]`, `new Set()`, `new Map()`, `false`, `0`, `''`, empty object.
- **Syntax shapes:**
  - ternary on `._tag === 'Success'` / `'Failure'` and on `Result.isSuccess`/`isFailure`;
  - `if (… Failure) return <absence>`;
  - `Result.getOrElse(() => <absence>)` and siblings;
  - `Option.getOrElse(() => <absence>)` — only when the `Option` came from a failure: `Effect.option`, `Result.getSuccess`, and the like;
  - `match` with `onFailure: () => <absence>`.
- **New shapes join `FORMS`.** Allowances for them are declared the same way, with `why`. A branch answering a typed value or the failure itself is no violation.
- **Limits** the inspection appends to its own description — as now, no promises beyond what is syntactically visible.

**Proved by.**
- Unit tests of the package per shape: violation, non-violation, allowance.
- A `check_rules` measurement over the rule region: new-site count by place — the list itself not needed.
- The change landed in main through `submit_work`.

`enforce_rule` is not done: the coordinator records debt and its owners from the measurement.

Set in `e3324b0f69`: five absence shapes, exact allowances, and syntax limits; 28 unit tests and typecheck pass. Current-reader CLI on that commit: 111 new violations and 30 unjudged over 3231 paths in 13.9 s; 16 reviewed candidates in allowances leave 95 violations. In change-record — 10 violations and 1 unjudged, the rest 85 and 29 after allowances. A check through the running server did not confirm the extension: `check_rules` returned the old 0 violations/24 unjudged; the divergence is recorded in [[0da4b4f7|server reader observation]]. A new random 20-site sample gave four defective sites in three works: [[b1f87087|hook loss]], [[072fb619|stop receipt]], [[d0051b98|batch read]]. The other 16 need exact allowances, prepared for the coordinator; enforcement unchanged.
