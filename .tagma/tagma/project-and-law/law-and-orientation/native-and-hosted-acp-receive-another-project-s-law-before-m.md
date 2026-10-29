---
id: 01a14c14-a11c-7ce8-9d84-6330ccb2aa49
title: Native and hosted ACP receive another project's law before mutating
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632c6aeb5d45
sources:
  - kind: file
    ref: apps/tagma/server/src/invocation/perform.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/instructionRule.ts
---
**Value.** A native agent and hosted ACP receive another project's rules and dictionary before their own edit; work across repositories keeps the place's law.

**How.** Native and hosted ACP admit a mutating act on a law snapshot taken before the assistant message that spawned the call; guidance delivered after a neighbouring tool call in the same batch doesn't authorize it. With no snapshot, the call refuses, and the next step brings the set. HTTP/MCP delivers the law in the first refusal; the retry passes.

**Behaviour.**
- The place is recorded for the thread and survives restart and compaction; the project's law then arrives together with the home law, its edits as a diff.
- Reads pass at once, without refusal.
- An unreadable graph of another place removes it from the thread with a cause and doesn't block the home turn; the next write there waits for the law again.
- Another CLI receives the place's law through the hook under the same delivery lock, so a late hook doesn't revoke new law with an old snapshot.

**Limits.** The global graph doesn't count as a place: its rules are already in the home set. Another copy of the home project brings not the set but the law by touching its paths. A call parallel to the first HTTP/MCP refusal may pass before receiving the law. The hook reports a file write after it, so another CLI may receive the law later than its own edit.
