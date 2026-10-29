---
id: 01a164ee-a2e1-7c4d-9108-11d49b754eef
title: set_module drawing a relations cycle refuses with inspection-failed and advises 'enforce again'
ord: 103
tags: ["reflection"]
fields:
  {
    "actual": "refused[inspection-failed]: 'the module map … relations close a cycle, `ui` -> `web` -> `ui`'; unblock 'set_module with the module cards corrected, then enforce again'",
    "command": "set_module project=39 modules=[{id:\"ui\", imports:{put:[\"web\"]}}] with web → ui",
    "expected": "a refusal named by the card condition (a relations cycle), with the exit 'set_module without the ui → web relation' — no words about checking and enforce"
  }
---
Filed from project `runlith`.

The point stands — the card not recorded. But the `inspection-failed` code means "the check could not run", and the refusal's reader (an agent) goes to fix the inspection environment; "then enforce again" does not apply to set_module, which needs no enforce. Experiment: step 15 under b85acc68.
