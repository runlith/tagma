---
id: 01a193f6-b637-7d1e-b520-d3c8a3fcb0b1
title: Ensure rejected command admission cannot start an execution
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193f6-f75f-7249-8b8f-36444a9361c0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15e9d-abe2-748e-bbe0-3208b7c07b6f
---
The recorded case does not establish a rejected admission. In [[01a15bf0-3223-73c0-ba1d-c4a462582feb|the reporting thread]], the run was in trust mode; records #1590–1592 show execution started at 13:18:37.649Z and the actual model-facing result was a background receipt at 13:18:43.716Z, following operator words at 13:18:43.451Z (#1593). Completion followed at 13:18:51.949Z (#1621). The next command was already started and then cancelled after 1.877 seconds (#1614). The quoted rejection is not present in those tool results; its origin remains unestablished. Current packages/agent/src/thread/run/ToolQuestion.ts:223–234 skips dispatch after decline, packages/agent/src/agent/door/ToolExecution.ts:538–555 returns an unexecuted outcome, and packages/agent/src/agent/AgentCall.ts:112–123 backgrounds an already linked command on new words. Five targeted existing tests passed in AgentCalls.test.ts, door/ToolExecutionCalls.test.ts and thread/conformance/hosting.itest.ts: handoff, pre-dispatch stop, both background approval answers and foreground decline. The historical execution reference is no longer held by this installation, so its host facts could not be reread. No code or approval-policy change was justified, so no implementation commit was made.