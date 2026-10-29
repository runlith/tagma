---
id: 01a16b30-366a-7e95-8882-3a75165a13bd
title: The Claude runner closes with the `_tagma/said` boundary a message Claude Code delivered whole, with no stream frames
ord: 117
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16b1d-99b2-7f46-a678-3c2fca6f33bf",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code/feed.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code/translate.ts
---
Thread [[01a16b08-ee15-7003-95b6-d5dd064444b4|01a16b08]] stood forever on 2026-10-23 at a `bash` call (`toolu_01Ng9yfkgF7EojAKdLbdSEjx`): a `queued`/`gated` record, "Running" with no buttons in the feed, the command never launched.

Cause: after four 529s Claude Code received the model answer (`msg_011CgL3EqaW7t4RYhh6bJpQe`) with no stream frames — in its session file that is one `assistant` record with all blocks at once, not a record per block as with streamed messages; the step has neither the measurement nor the boundary the runner derives from `message_stop`. `Translation` derived the `_tagma/said` boundary only from `message_stop`, so the streamless message got no boundary. `ThreadHosting.performed` waits for `reached` — the message record with this call — before admitting the call; Claude Code waits for the call result, and the turn never ends.

Fix at the boundary producer: a message whose stream never started (no `message_start` with its id) is closed by the runner with a boundary right after its calls, naming all its `tool_use`. Proof — a runner contract test on the incident scenario: repeated 529s, then a whole message with a Tagma call.
