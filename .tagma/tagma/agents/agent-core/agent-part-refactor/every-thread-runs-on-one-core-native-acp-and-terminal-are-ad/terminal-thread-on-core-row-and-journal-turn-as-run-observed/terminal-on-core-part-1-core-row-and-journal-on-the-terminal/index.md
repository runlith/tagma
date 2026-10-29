---
id: 01a11d9b-499b-7e23-9633-4a036232d2bb
title: "Terminal on core, part 1: core row and journal on the terminal thread, turn as run, observed, ending by Stop and transcript; session migration and rollout steps"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14dd1-43cd-7723-af0a-5cf815955c6a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60b0a621fbb3
---
Done: `24eaec33cb`, `668ed4c616`, `9d78691513`, `c51e0eaaa9`, `78f9c0e230`, `e12f44b466` — core row, journal, terminal runs and migration, delivery and wake; the [[a94baa59|delivery subtask]] is complete. `a922f28f23` — Stop during launch ([[b133508a]]); `c421416980` — lease beat without scanning all threads; `8e93772d2` — Stop on an open but unrestored session keeps words, Stop before words are recorded does not hang, one `OpenRuns` stores who stopped the run.

The end-to-end migration test for the [[a63eba68|storage cut]] no longer runs: the terminal-session carry step is folded into the base migration (see [[a621fbb3]], "What came out differently"). `terminalRuns`, `terminalTakeUp`, `terminalWatch`, and `terminalDelivery` prove recovery of unfinished work (adopt, question carry, one report).
