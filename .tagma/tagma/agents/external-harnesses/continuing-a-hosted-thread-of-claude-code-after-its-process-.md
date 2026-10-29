---
id: 01a16b5d-797d-753b-b118-85356a4f0313
title: "Continuing a hosted thread of Claude Code after its process died is refused by the vendor: history ends with an assistant message"
ord: 119
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16b5d-c745-7568-9d9c-85a8d6f84491",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16b30-366a-7e95-8882-3a75165a13bd
---
Observation of 2026-10-24 on thread [[01a16b08-ee15-7003-95b6-d5dd064444b4|01a16b08]] (Claude Code over ACP, `claude-opus-5-5`). Turn `01a16b5b-886e-74c1-88bf-ff2909acee32` ended in failure: the runner process was killed, `exited with code 130`, while its `edit` call had already answered by then. The next turn `01a16b5c-187f-78fa-99e7-308738facb7a` — a continuation with no new words, on a new runner — failed after 4 s with the Claude Code answer `-32603: API Error: 400 This model does not support assistant message prefill. The conversation must end with a user message.` Only the parent message moved the thread (turn `01a16b5c-5fee-…`).

The cause is the empty input in `Turn.start`, not the unclosed earlier call: the kept Claude Code 2.1.306 transcript of session `49f920d8-00b4-4691-bfa3-138686b49592` ends the earlier turn with the `edit` result at 00:42:21.597Z, then adds a synthetic assistant `No response requested.` after resume at 00:42:43.441Z and receives the 400. Fix `434f96cb05` sends a non-empty instruction when history, context, and prompt gave no content, keeping the earlier messages. `claudeContinue.itest.ts` checks it through a real `continue_agent` of the parent, an ACP driver, and a runner with a scripted SDK: after the result the process itself exits 130; a wordless continuation loads the earlier session and ends `completed`. Without the standing fix the same scenario gets the prefill refusal; with the fix it passes on seeds 1–3. No vendor, real CLI, or server restart was used in the check.
