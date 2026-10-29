---
id: 01a13bb7-e74e-7e53-aabe-73a8f6252b3d
title: enforce_law drops absorb fingerprints its measurement did not find, silently, and still writes
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "The act ran and recorded an enforcement (\"last enforce at 2026-10-14T18:40:35 by session 2202\", revision unchanged 308b19f161c4) answering \"debt before (0): none / debt (0):\"; the nine absorb entries vanished without a word. The answer's own description of the builtin was the old one (no Effect.result sentence), the only hint that the server's checker is older than HEAD.",
    "command": "enforce_law {blockId: ea465bed, base: 308b19f161c4, strictness: gate, absorb: [9 fingerprints, e.g. \"packages/agent/src/thread/run/SenderWakes.ts senderWakesLayer.drain failureReturn e3cc9b19\"], owners: {each → 498ffdb9}}",
    "expected": "A refusal naming the absorbed fingerprints the measurement did not find (here: the running server measures swallowed-failures with its loaded build, which predates commit 798376ceea that introduced these sites), so the caller learns no debt was recorded and why."
  }
---
Filed from project `runlith`.

Cost: one write of a 275-allowance document with nothing changed, an 80 KB answer, and a debt recording the task asked for that cannot happen until the operator restarts the server. Nothing in the answer says the builtin code that measured is older than the checkout HEAD it measured at.