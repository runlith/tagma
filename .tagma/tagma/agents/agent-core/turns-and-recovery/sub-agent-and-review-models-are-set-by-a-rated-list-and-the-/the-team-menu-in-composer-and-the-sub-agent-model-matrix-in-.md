---
id: 01a150e6-3b13-7463-991d-5577e61d2614
title: The Team menu in composer and the sub-agent model matrix in Settings
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1510e-527b-7b9a-ab10-900c5e443a7c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a150e5-fbff-700e-98b9-7039ac67b9de
  - kind: waits-on
    to: 01a150e6-3b12-7a97-bfba-b23581d1cf66
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/AgentSection.svelte
---
Client part of spec [[ac67b9de]] per mockup http://localhost:5634/a/c3b9d910efd2: the Team button opens a menu (Agents, Depth, Models ›, Review ›, Only this thread / Reset to project), model lines with the `Gauge.svelte` quota indicator; in Settings instead of the "What each model is for" form — a lines × fields matrix with Add / Remove / Reset to default and the machine-level review-policy form. Waits for the server task's settings schema. Proof: app typecheck, minimal menu-contract tests (an edit writes the project or thread layer), browser check.
