---
id: 01a14b99-1519-7b10-8acc-248334febd1b
title: Withdrawing an unanswered turn removes its words from history together with the runtime guidance
ord: 67
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14b98-23aa-73bb-9dac-809ea5f8a420",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14b97-0ba9-7319-ad50-4239c34a6c2b
sources:
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/closing.ts
---
The cause is the producer's [[c34a6c2b|withdrawn-words leak]] in `RunLifecycle`: it subtracted one message from the history length, though after the turn's single input the history already held context and runtime guidance. In a native thread, that left words from #18873 standing after #18876 on the [[01a125fe-9260-7644-9a64-589c9bc19e19|polygon]]. Folding and the history cache executed the recorded keepMessages correctly. Now settlement finds the last message opening the turn by the shared `opensTurnMessage` and cuts history before it; zero, already-answered, and multi-input turns keep their earlier conditions. This also holds unmarked observed inputs.

The public stop→send test was red: the next run received the withdrawn words and the context. It strengthens the earlier stop test, keeping the feed and journal checks and adding the preservation of the preceding dialogue; green on InMemory and SQLite. After one Sol xhigh review a confirmed displacement regression was fixed, proven by the existing public test. 12 stop tests, 17 lifecycle tests, and 2 displacement cases pass; the stop file after merging overlapping checks fits the unit budget. `bun run tagma:typecheck` exits with code 1 over someone else's `conformance/runLog/processes.ts(107,33): TS2345`, where `Tool.make` misses the required `display`; that path did not change. The operator's server and the already-recorded history of its thread did not change.
