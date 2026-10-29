---
id: 01a0ff2b-54ff-7f7f-91d2-8f53e04bf041
title: The thread-request capture holds the sent prefix with the completed response and send time
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentAside.ts
  - kind: file
    ref: packages/agent/src/agent/turn/call.ts
  - kind: file
    ref: packages/agent/src/thread/ThreadAsides.ts
---
After a turn, an aside question to the thread sees the model's last response and sends the same prefix that went in the last request — so the provider cache can be reused. Actual cache use is measured by usage. Recap rests on this.

## What stands today

- `agent/turn/call.ts:119–134` creates the aside on the step's first output event with `lowered`, i.e. before the response.
- `AgentAside.ask` appends only the instruction to this (`AgentAside.ts:85`).
- `ThreadAsides.hold` keeps the capture until an explicit TTL counted from the hold moment. Without TTL, `settled` drops the capture at the run's end (`ThreadAsides.ts:27–46, 84–89`).

Recap on such a capture would not see the final response, and providers without a declared TTL would keep no capture after the turn at all.

## What is built

- At the step's end, `packages/agent` yields a completed capture:
  - the exactly sent messages;
  - the model's completed response in the form it would enter history in;
  - the same tools, `activeTools`, and `toolChoice` — removing them would change the cache prefix;
  - binding (origin, account, cache);
  - the request's send moment `sentAt` and its measurement moment `measuredAt`: TTL counts from the first, the warmth-curve span from the second.
- `ask` on a completed capture sends the prefix, the response, and the instruction. A tool call in response still yields `AgentAsideCalledTool`.
- `ThreadAsides` holds the thread's last capture. The first-output capture used by naming is replaced by the completed capture at the step's end.
- The keep duration under a declared TTL counts from `sentAt`, not from hold: a long response does not silently eat the window.
- The capture is not copied. A new run replaces it.
- A consumer needing the capture past the run's end (recap) takes it before `settled` releases it, and holds it itself until the answer, cancel, or expiry.

## Acceptance

- An aside asked after a turn receives that turn's response.
- Usage of such an aside on a warm thread shows prefix reads from cache. Verified with one sample on a real provider.
- Naming keeps working on the first-output capture.
- A new run replaces the capture.
