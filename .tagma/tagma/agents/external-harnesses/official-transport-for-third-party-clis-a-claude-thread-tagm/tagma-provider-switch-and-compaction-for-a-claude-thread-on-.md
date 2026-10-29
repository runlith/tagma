---
id: 01a108d1-82f5-71b6-88da-157b256cf202
title: "Tagma provider switch and compaction for a Claude thread on acp: runner history from the Tagma journal, acp ↔ native both ways"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10e33-bba6-7a50-89f0-67a2e591373c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
  - kind: waits-on
    to: 01a1089e-978d-7423-bc88-3a1f9d90bce3
---
Decisions 2 and 11 of spec [[adb9cd5b]]. Done: a Claude thread on `acp` switches to native GPT or Grok and back via `set_agent_model` and the chat model picker, with a single feed; compaction on this thread looks native. The same mechanism — a vendor session assembled from the journal's edited history — provides fork with `carry: N` and rewind with `scope: 'turn'`, which until this task answered with a typed refusal.
