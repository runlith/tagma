---
id: 01a1544f-1f71-784a-9cb6-50bbf25bb1e1
title: "After restarting the working server, give the oxfmt step in tagma.jsonc `reads: \"nearby\"` and repeat the one-file landing sample"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a153af-4a0d-7b84-a30a-9545dc36a399",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15417-4ea3-7cfd-8032-89c71b48552d
sources:
  - kind: file
    ref: tagma.jsonc
---
The server on a build before `c6c6d7e566` does not know the `reads` field and would count the steps declaration invalid, so this can only land after the operator restarts the server. For `oxfmt` the value `nearby` is right: its config `.oxfmtrc.json` and `.gitignore` stand at the root. After landing, repeat the [[1b48552d]] spec's acceptance: 5 one-file landings with no import changes, `submit_work` median and rule-judgement time. Then close the spec.

Result 2026-10-19, working server after restart, separate worktree, a one-line edit in `conditions.ts`, one sample. `submit_work` by spans: first landing 5.87 s (preparation 3.0 s, judgement 2.27 s), then 2.62 / 2.10 / 2.41 / 2.06 s — median 2.25 s. Rule judgement: 0.76 / 0.50 / 0.64 / 0.49 s. An edit with `node:fs` in a browser-reachable file and an `Effect.gen` wrapper with `Date.now()` refused `law-violated` under three rules: platforms with a chain and two effect-style rules.
