---
id: 01a14584-9526-7cf0-8c63-d391f5bfe55c
title: The Claude thread profile can pick a CLI permission mode instead of bypass
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a141bd-4d86-7052-9111-958c8dc139ae",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a141bd-1de3-79e9-903b-8de5136ee86c
---
The Claude harness always adds `--dangerously-skip-permissions` (`vendors/claude/row.ts`, `permission.tagma`), and the plain thread also stands in bypass. Per spec 510a47c0, plain launches the CLI as shipped: Claude Code 2.1.301 defaults to `auto`.

As clarified by the operator: bypass stays the default. Do this: a `threads.harnessProfile.claude.permissionMode` field (auto, acceptEdits, bypassPermissions, manual, dontAsk, plan) — with it the CLI launches with `--permission-mode <mode>` instead of `--dangerously-skip-permissions`; without it, as today. Permission questions in the chosen mode rise as screen questions to the parent (check the widget reads). Proof: an argv test, a live launch of the real CLI on a config copy, typecheck, Sol xhigh review.
