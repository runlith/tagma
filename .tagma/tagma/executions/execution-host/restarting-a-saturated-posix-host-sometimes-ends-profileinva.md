---
id: 01a16ee1-0189-793d-a4c7-dd62f2bebf04
title: Restarting a saturated POSIX host sometimes ends ProfileInvalid at census
ord: 45
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16fbe-75e3-7f19-8568-ed3a829a1d7f",
    "status": "done"
  }
---
Fixed in 2e4a5b27ca with no softening of the native capacity contract. Under load1=31.02 a real capacity.itest after nofile=36 saturation and restartLogic reproduced ProfileInvalid: 10 logic descriptors available against a 12 spend on the pipes execution. Census no longer counts its own probes' pipes as standing spend: the logic's and the holder's fds read straight from the kernel table ahead of PS/lsof.

Normalizable reservations, open record handles and the connection reserve are fixed synchronously with the fd snapshot. A belated adopted-child finish and a new connection never change that deduction; the live promise holds, and post-sample reservations never settle. Late process/PTY counts subtract the current population's own. The contract is kept in [[e587c6f4|the accounting agreement]] and [[57b676b4|the census boundary]].

Causal regression with a real recovered /bin/cat and held globals: the old late-account semantics gave ProfileInvalid with 6 free fds against a 12 spend; after the fix initialize declares exactly one place, the next gets CapacityRefused. A unit arrival scenario pre-fix gave capacity 2 instead of 1; an early-live/late-PS skew was separately caught and fixed. ExecutionCapacity 25/25, lateCapacity 2/2, nativeLaunch 22/22 and capacity, lateLimits, processCapacity, terminalCapacity passed separately on seeds 1–3; macosReadings 13/13 on seeds 1–3, package typecheck green. The final six of host integration — 78/78 at load1=28.81. One P2 of the independent review fixed in the same round; no repeat review ran.
