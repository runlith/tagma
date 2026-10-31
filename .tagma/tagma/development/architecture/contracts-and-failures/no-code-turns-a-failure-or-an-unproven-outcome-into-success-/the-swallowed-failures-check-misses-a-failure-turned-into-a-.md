---
id: 01a13b48-b2ed-74ae-b38b-fcaa7331882a
title: The swallowed-failures check misses a failure turned into a value via Effect.result with no log and no reason
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13b94-f4aa-7258-ab96-ca3e94bc200d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13b37-5351-7e3a-bda9-f7c22e414755
sources:
  - kind: dir
    ref: checks/law/swallowed-failures
---
The swallowed-failures check misses a failure turned into a value through Effect.result with no log and no reason. The rule on swallowed failures forbids turning an arbitrary failure into success, but its `swallowed-failures` check only catches `catch` shapes. The same failure passes through `Effect.result` + a `_tag` branch answering `false`, `undefined`, `true`, or a fallback value: a selective read of 88 of ~1100 places (2026-10-14) found 10 such places with no log and no reason, about 11% of the sample.

Teach the check this shape: an `Effect.result` result whose `Failure` branch answers a value with no log/refusal and no allowance in the check config. Places it finds now are recorded as debt on [[498ffdb9]]. Proof — the check finds the places listed there and does not fire on a branch answering a typed refusal or logging the reason.

Done (commit 798376ceea): the check in both doors (builtin and `checks/law`) judges branches over a local `Effect.result`; measurement over current code with acting allowances — 264 branch violations and 106 unjudged, 9 of 10 [[498ffdb9]] places violations, `submit.ts:268` unjudged (the reason is kept in `unrecorded`). The debt on [[498ffdb9]] is not recorded: the running server measures with a build older than 798376ceea, and `enforce_law` with `absorb` silently dropped the fingerprints (reflection f6252b3d). After the operator restarts the server the new sites will stand in escaped, and they must be taken with `absorb` owned by [[498ffdb9]].
