---
id: 01a13fce-a142-731b-a59b-5e74e07f5cc7
title: An `inspection-failed` refusal carries in `unblock` the exits the inspection itself named
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13f95-60fe-7047-a344-e33f81074aa9
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/unread.ts
---
An inspection that knows the exit from its own failure now puts it only in the reason text. The worker reduces the failure to `Unread { cause, reason }`, `measure.ts` (`failed`) and `failedRefusal` in `judging/judge.ts` give generic advice in `unblock` — check_rules, the team-living rule — while the reader digs the real exit ("declare `built` via enforce_rule", for `InputAbsent` at `modules`) out of reason.

To do: an inspection failure carries its own `ways` through `Unread`, the worker answer and `InspectionFailed` to the `unblock` of the `inspection-failed` refusal in measurement (enforce_rule, set_module) and in the landing gate; generic advice stays for failures with no paths of their own. Check: a `set_module`/`submit_work` refusal on a tree whose tsconfig inherits a missing generated file carries the exit via `built` in `unblock`.
