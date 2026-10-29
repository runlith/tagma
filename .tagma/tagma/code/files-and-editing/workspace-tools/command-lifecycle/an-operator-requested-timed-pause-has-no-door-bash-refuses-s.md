---
id: 01a14a56-2822-7be5-9132-c1c5ecff045e
title: "An operator-requested timed pause has no door: bash refuses sleep-only commands and nothing wakes a thread later"
ord: 19
tags: ["reflection"]
fields:
  {
    "actual": "Refused `sleeps-only`; the recovery names only waiting on a command, an agent or a condition. No operation schedules a wake of the agent's own thread, so the instruction cannot be carried out except by disguising the sleep as an `until` loop on the clock, which routes around the refusal.",
    "command": "bash {command: \"sleep 600\", waitMs: 600000, lifeMs: 660000}",
    "expected": "The operator asked the agent to pause 10 minutes and then continue its work; one act should hold the turn (or schedule a self-wake) for that time."
  }
edges:
  - kind: relates
    to: 01a1696f-9c19-712f-abc1-abc6d5c27a25
---
Filed from project `runlith`.

Seen in thread 01a14a55-73a4-7d5e-86a3-fb1085616c41 (debt-fix) on 2026-10-17: the operator's message was "set a timeout for 10 minutes and then continue". The sleeps-only guard is right against an agent idly holding a turn, but an explicit operator pause needs either an exemption or a timed self-wake door.
