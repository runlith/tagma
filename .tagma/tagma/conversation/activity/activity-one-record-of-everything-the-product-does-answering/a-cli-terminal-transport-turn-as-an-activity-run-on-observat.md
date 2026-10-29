---
id: 01a11295-2b80-73ec-910f-3e7886c58c46
title: A CLI terminal-transport turn as an activity run on observation transitions
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-9161-7df7-9c19-57611b71ea05",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a111c0-a6a5-7a73-8f4d-f9f410d560ac
  - kind: implements
    to: 01a111ad-1d14-7079-ad84-43a6a5fd6a10
---
CLI terminal turns must leave an activity `run` under the core run's id: the start comes from the hook; launch and restore open one episode, a confirmed end and a launch refusal close it. The owner shared with ACP keeps the actor, the inbox cause, and the known usage, and marks inner model steps unobserved. Thread deletion waits for the write confirmation while its project still reads; the write queue creates no global attribution loss after deletion. Check — `terminalAsks.itest.ts` ahead of `activityWindow.itest.ts` under a shared runtime: another project's window stays full with the coverage assertion unchanged. Three confirmed review defects are fixed by one named end-obligation subscriber: displacement closes the previous episode; usage reads from the committed row, not the async request subscription; outcome and stoppedBy come from the core settlement, including LATE_STOP. The displacement scenario is reproduced red without the subscriber through hook and read_thread; terminalCore (8 tests) and terminalProof (5 tests, including full usage and late stop) are green separately on seeds 1–3. The activity write barrier and deletion with admission/drain preparation were previously landed in 9b33a8424e. The activityWindow completeness assertion is unchanged.
