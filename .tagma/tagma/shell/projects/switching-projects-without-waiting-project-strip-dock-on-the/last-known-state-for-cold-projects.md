---
id: 01a13d1d-cf8d-7804-a695-42fc88091580
title: Last known state for cold projects
ord: 8
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
Question: whether to show a cold project — visited but evicted from warm — as the user left it, marked "updating", until fresh data arrives.

Why: a move to a project past the three warm ones waits on the server again.

What decides: the measurement ([[2516a131]]) — how often moves land on cold projects and how long they wait.

Against: that's a consumer-side cache, and rule [[2393aff1]] says to remove cost where it's produced. First speed up whatever the measurement shows slow on the server. This idea only if a cold move stays long after that, and then with the operator's exception decision.

Risk: a couple seconds of stale view. An act on a row that's gone gets a server refusal, and the interface must show that clearly.
