---
id: 01a151df-e920-73d7-9b09-09d576cf9bbf
title: Codex shell calls in the TUI deliver the law of the shown files — proven on a real-form event
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-6ae2-72a7-8565-b02edaf63602",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
  - kind: relates
    to: 01a11d92-f13e-70e0-a79e-313114005f86
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/vendors/codex/row.ts
---
The Codex adapter parses PostToolUse with the shared `claudePrinted` (`vendors/codex/row.ts:197`), which expects Claude Code fields: `tool_name: Bash`, `tool_input.command`, `tool_response.stdout`. The shell-call event form of Codex is not recorded in Tagma: the [[14005f86]] probe logged Codex 0.159.0 hooks but did not fix the tool-answer fields. Law delivery on Codex shell is unverified coverage, not a reproduced failure.

Do: capture a PostToolUse shell-call event of the current Codex (`sed -n`, `rg`, `cat`) and record it as a #research; if the fields diverge, the Codex adapter row gets its own parse instead of `claudePrinted`.

Done (`1f2d690fbb`): the Codex 0.162.0 probe is recorded in [[5cacb6eb]] — a shell call arrives as `tool_name: Bash`, `tool_input.command` and a string `tool_response` stdout. `claudePrinted` takes a string answer whole, so the Codex row needed no parse of its own. Test `hookContext.itest` "a Codex shell call, in the form Codex 0.162.0 reports it, …": `sed -n` on a file asks that file's law as `read`, `rg -n` asks found files as `found`, the answer goes to the CLI as `additionalContext`. Not proven: the TUI form (captured in `codex exec` of the same build), failed and background commands; the rule and pointer choice by the graph is stubbed in the test (proven for Claude Code by `hookFirst.stest`).

Proof: a hook test with an event of the recorded form: reading a file through Codex shell brings that place's rule, searching brings an explanation pointer.
