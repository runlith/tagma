---
id: 01a0e9e9-0878-73d1-998d-d8aaf825b4bf
title: "agent: a tool door gets a real lifetime its owners close, so its preflight and outcome memos end with it instead of with the process"
ord: 94
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
---
`AgentToolDoor` is a plain class with no close. Its two keyed memos, preflight and outcomes, hold settled results so that a replay does not rerun a tool. They are retained memo results, not waiters, so the `held` waiter primitive [[d6a03cb0]] does not fit them, and they carry `held-resources` debt owned here.

Why no scope serves today:
- the running door outlives the run fiber through `onComplete` and detached background settlements;
- the `runs` Scope spans all runs;
- doors are also minted for parked answers and without a run;
- public constructors are reached from promise/index.

Target: the door has an explicit lifetime, per door or per run, that ends after its last settlement. Every production owner closes it, including the constructors outside `packages/agent`, and closing drops both memos.

Done when the memos are bounded by live doors, a unit test covers close, and both debt entries retire. This belongs with the kernel lifecycle work of the threads and native-harness waves; take it there, or earlier if a lead is free.