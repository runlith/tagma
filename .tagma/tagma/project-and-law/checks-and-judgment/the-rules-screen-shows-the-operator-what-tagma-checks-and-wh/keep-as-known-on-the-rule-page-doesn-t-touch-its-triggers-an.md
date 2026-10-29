---
id: 01a16179-9098-7669-a543-180921cc856b
title: "\"Keep as known…\" on the rule page doesn't touch its triggers, and the decision dialog tells the truth about the count and the agent thread"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16169-1dc4-71d5-9d99-101ef6e22e15",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/rules/Engine.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/rules/Tighten.svelte
---
"Keep as known…" sends `enforce_rule` with the same strictness, but Engine counts triggers as on a strictness change: on a Warns or Blocks rule without a pre-landing trigger (e.g. only `submit_work` after) it silently adds `submit_work` before — the rule starts judging, and on Blocks refusing landings, though only "keep as known" was pressed. Only a strictness transition adds a trigger.

With a single violation, the decision dialog says "them", and "Fix them first" promises the agent will remove them now, though the button only opens a thread with a draft the human sends.
