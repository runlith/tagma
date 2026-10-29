---
id: 01a107e9-2f31-797c-a0dc-77e30fcb2de4
title: "Step trace attributes every HTTP request's outcome to the first: the presentation bootstrap GET gets the model stream failure while the model POST stays open"
ord: 17
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a10553-8e46-717c-8cd5-4323da4bac13
sources:
  - kind: file
    ref: packages/llm/src/llm/route/definition.ts
  - kind: file
    ref: packages/llm/src/llm/route/executor.ts
  - kind: file
    ref: packages/trace-bundle/src/replay.ts
---
What's wrong: in one step, every HTTP request of the executor goes under one `transportAttempt` number. Those are the Claude Code presentation bootstrap requests (`GET /api/claude_code/settings`, `policy_limits`, and others) as well as the `POST /v1/messages` itself. `attemptOf` in `packages/trace-bundle/src/replay.ts` looks the attempt up by number via `find`, so every `transport-attempt-responded` and `transport-attempt-failed` of the step lands on the first row. In trace it looks like this:
- the GET settings response status and the model stream's own failure (`StreamStalled`, `afterMs` ≈ step length) stand on the `GET .../settings` attempt;
- the `POST /v1/messages` row stays `open` forever with no status;
- the other GETs also hang `open`, all opened within one second.

Example: thread `01a1050e-6093-75b1-8e1f-f17763f9cb47`, run `01a105da-cbbe-7102-9606-ee90378aa697`, facts `attempt:0.0`–`0.5`. Exactly this derailed the [[da4bac13]] investigation: "several attempts opened in one millisecond and stayed open".

Do: every HTTP request inside a transport attempt gets its own identity, carried by started, responded, and failed. Replay matches events by it, not by number. A stream failure after the response (`reportBroken` in `packages/llm/src/llm/route/definition.ts`) must land on the model request, not the step's first request.

Done when, on a step with bootstrap requests, every attempt row is closed with its own outcome and the stream failure stands on the model's `POST`. A replay test on such a step, failing on the current code, proves it.
