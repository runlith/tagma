---
id: 01a16ae6-5dc7-77af-b7bf-640b7bc6810f
title: "Awaiting on an ACP turn yields to the operator's words before they reach the agent loop: the next model request leaves without them"
ord: 116
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ae6-b3ca-7181-b362-680d0ecdd09b",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/adapter-anthropic/src/runner/turn.ts
  - kind: file
    ref: packages/hosted-runner/src/relay.ts
  - kind: file
    ref: packages/agent/src/thread/run/hostedWords.ts
---
On an ACP turn (Claude Code), a call that waited (`wait_command`, `read_output` with waiting) ends with a `wait-ended: The operator's words arrived…` answer. But the next model request leaves without those words: the model steps blind, and the words arrive only at the next step boundary — sometimes after the final answer.

**Evidence** (from thread journals):
- `01a16a94-8d3a-7610-abd9-8503665bc41f`, 2026-10-23: words recorded at 21:13:31.874, the wait broke at 21:13:31.937. The next request (#527) held only the tool result. The model wrote “An operator message apparently arrived but isn't visible to me yet”, finished the report, and only then did the words land in the same turn (#532).
- `01a16503-0da1-7563-9310-9f418a0e63bc`, 2026-10-22 19:40:27: the wait broke 29 ms after the words. The model called `wait_command` again, it broke at once too, and only then did the words arrive (#781). The call ran unbroken since 19:39:40, so no server restart is involved.
- The same pattern — two `wait-ended` in a row — in `01a16063-3d26-728c-a9fe-a15d601d54a5` (2026-10-22 15:47).

**Cause** (from the code):
- `HostedWords` (`packages/agent/src/thread/run/hostedWords.ts`) yields as soon as a word appears in the inbox as an unread steer or report.
- The word reaches Claude Code by another channel: the ACP driver prepares it (guidance notes, attachments — on a separate fiber, `ProtocolPreparing`), sets an input claim and sends `_tagma/steer`. The runner hands it to the query with `next` priority, and Claude Code lays it in only at a step boundary.
- The `call_hosted_tool` answer leaves for the runner over HTTP before the steer, and Claude Code assembles the next request without the words.
- The “Claude Code assembled the request before the steer arrived” link is inferred from timestamps and code, not measured.

**What must stand:**
1. A hosted-call result reaches the agent loop only after every word it yielded to already stands in that loop's queue. Order holds by construction, not by two-channel timing — just as a native step reads unread words right after results.
2. Waiting on such a turn yields only to words that will actually be handed to the agent. A word withdrawn by the operator before handoff, or a line waiting for the next turn, never breaks the wait and never holds the runner.
