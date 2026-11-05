---
id: 01a1ad4d-713a-73ed-8430-1c8183ea0c32
title: A step back returns thread journals a newer form step already cast
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a126f6-6c5e-795a-b256-2e311e57a53b
  - kind: relates
    to: 01a1ad3a-f8a3-7ca8-ac2e-6d6fdef31b76
---
A step back returns every SQLite store onto the previous release's chain, but not thread journals: a form step (`ThreadFormStep`) is forward-only, and a thread the leaving build already cast with a step the previous release lacks keeps that form. The older build then cannot shape that thread until the newer build stands again (it refuses the file or its mark; inferred from `RolloutForms.readable` and the mark contract, not reproduced).

Wanted: the leaving build, while it carries a step back, brings every journal it cast past the target's last form step back to a form the target reads — a reverse function declared with each form step, run over the thread files and their SQL rows the way a forward cast runs (in the journal worker, one thread at a time), with the thread's form mark set back to the target's last step. The step-back carry (`composition/returning.ts`, `installation/process/returning.ts`) must learn the target's step names from the target installation, and the real-door itest gains a journal form step the target lacks.

Not done in the change that landed chain return because that work was told to stay out of `packages/agent` and `apps/tagma/server/src/threads` while another agent fixed a transcript decode defect there.
