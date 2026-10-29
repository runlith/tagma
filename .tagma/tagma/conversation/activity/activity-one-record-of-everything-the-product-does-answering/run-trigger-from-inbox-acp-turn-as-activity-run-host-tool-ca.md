---
id: 01a111c0-a6a5-7a73-8f4d-f9f410d560ac
title: Run trigger from inbox, ACP turn as activity run, host tool calls through the combinator
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11269-fca7-7a2a-8350-dac3482c7dbe",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a111ad-1d14-7079-ad84-43a6a5fd6a10
  - kind: waits-on
    to: 01a111c0-a6a5-7a73-8f4d-f9f23b1981ef
---
Done: native run causes come from the delivered inbox, including separate compaction runs; ACP holds one activity `run` per observed turn episode with the CLI-reported model and usage and a `modelSteps: unobserved` mark. Host tools, including `ask_user`, write `tool-call` with the shared combinator and an explicit run parent. All triggers use `refs`.

Verified: 188 tests of the combinator, runner, aggregate and collaboration; 62 tool-door tests; 6 `protocolRuns.stest.ts` system tests, including reading a run, its trigger, and a child tool through `read_thread` source `activity`; native `runActivity.itest.ts` — 1 pass, file 3.43 s wall time on this machine. Activity typecheck passed. Agent and server typecheck stays red on others' unfinished changes: `userMessage.test.ts:16` TS18048, server — 12 more diagnostics in naming/recap, operations and flow tests; paths changed by this task produced no diagnostics.

Open: terminal. Admitted observations yield session/root, an optional vendor turn id, observed start/end, and scoped model; they do not prove a per-turn `thread_run`, usage, or the inbox-to-turn link. A partial activity `run` could leave `run` and usage unnamed, but its lifetime must follow the observation owner's admission, rebind, and invalidation — a separate change, not wiring up the ACP driver.
