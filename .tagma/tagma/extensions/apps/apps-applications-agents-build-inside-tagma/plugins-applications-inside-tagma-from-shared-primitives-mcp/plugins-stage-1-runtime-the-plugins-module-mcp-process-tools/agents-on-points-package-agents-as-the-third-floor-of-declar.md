---
id: 01a12306-efba-7a0e-94d7-05ef511bce7b
title: "Agents-on points: package agents as the third floor of declaredAgents and plugin thread-end delivery"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12307-3158-7283-b07a-914aca49841c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
  - kind: waits-on
    to: 01a12306-efba-7a0e-94d7-05ecc0602266
---
The spec's “Tools and agents” and “Process” sections (Tagma → plugin).

- Agents `<plugin>.<agent>` as the third floor of `declaredAgents` (`threads/library/declared.ts`); the `plugin:<id>` capability in `AgentDefinitions`; a definition may withhold Tagma's standard tools; birth in `trust`.
- `on.ended`: a plugin-born thread's end is delivered through the run-end notification obligation already in place (`packages/agent/src/thread/storage/settlement.ts`), confirm — the tool's answer, retry, `notification-exhausted`, at-least-once.

Done when the test shows: the plugin's agent is visible under its id with `own` tools, its thread's end reaches the process, and an end that landed on a process restart is delivered after it.
