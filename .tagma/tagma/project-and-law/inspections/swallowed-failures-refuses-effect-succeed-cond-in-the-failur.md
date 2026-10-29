---
id: 01a1501d-befb-7af9-9ae5-62ae0483a851
title: swallowed-failures refuses Effect.succeed(cond) in the Failure branch, though it accepts the same branch unwrapped
ord: 54
tags: ["reflection"]
fields:
  {
    "actual": "refused law-violated ea465bed failureReturn on working.ts:68; the code had to be rebuilt (exactWorkingAt pulled out), an extra commit round",
    "command": "submit_work paths=[packages/files/src/working.ts, …] — workingAt via Effect.flatMap: if (read._tag === 'Failure') return Effect.succeed(read.failure === 'absent' ? ABSENT : { kind: 'unread' })",
    "expected": "Accept: this is the same conditional handling (ENOENT → absent, otherwise typed unread) that the gate accepts in Effect.map form with an unwrapped return"
  }
---
The cause is in the swallowed-failures `value()` (`apps/tagma/inspection/src/packs/effect/swallowed-failures/result.ts` and the copy in `checks/law`): `return Effect.succeed(x)` was judged through `carried(...)` and went silent instead of judging `x` as the returned value. Fixed in 16aa81b651: outside a generator `Effect.succeed(arg)` is judged as `arg`; `Effect.succeed(false)` still refuses (good/bad tests added).
