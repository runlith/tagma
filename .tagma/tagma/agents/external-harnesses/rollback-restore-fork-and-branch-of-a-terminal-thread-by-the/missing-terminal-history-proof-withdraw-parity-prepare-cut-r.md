---
id: 01a173ab-98bb-7d4a-bc2f-bc53da4f3bce
title: "Missing terminal-history proof: withdraw parity, Prepare-cut retry after restart, whole plain fork, Launch-cut re-judgement at binding, account change, re-raise vs next-turn race"
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a173ab-d37e-7304-93d2-b7fa37de7024",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17321-2895-71ed-b498-9b2711b4f93a
---
Without these tests the acceptance criteria ([[11b4f93a]]) are unmet: parity of the core withdraw suite on terminal and of the failure-window table. [[01a17326-ef22-7865-b9a0-10ff558b36ba|terminal-history-core]] proved the remaining cases by code reading only. Every test goes through the real caller's door, and the race test fails without the guard it proves.
