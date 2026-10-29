---
id: 01a15b89-5c49-706e-add8-3127383fb4ee
title: The Claude runner acknowledges an operator word injected mid-turn minutes late
ord: 87
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15b88-e429-73d6-a7bb-5e1330521d6e",
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code/turn.ts
---
In run `01a15b56-c63f-71e5-a724-f167deeee9c9` of thread `01a15ac1-2b9a-7fc6-b993-3b1f606e8186` Claude Code picked up the operator's word at 22:23:31–32 (the `queued_command` record and `queue-operation remove` in its journal; the model answered the word in the next request). The runner answered `_tagma/steer` `…:10` with `{"outcome":"injected"}` only after the `_tagma/said` of the 22:29:25 message — six minutes later. The cause is not established. Find out which SDK message `Turn.echoed` accepts as the echo of an injected word (with and without a picture) and why it arrived so late. Then acknowledge the word on the fact Claude Code takes it with.
