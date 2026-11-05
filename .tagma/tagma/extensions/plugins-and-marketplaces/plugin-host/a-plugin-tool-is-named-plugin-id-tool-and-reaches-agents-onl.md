---
id: 01a12320-6e0c-7fc3-a06c-15f512e4c3cd
title: A plugin tool is named plugin__<id>__<tool> and reaches agents only through its audience
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05ecc0602266
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/capabilities/plugins.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/toolPoint.ts
---
An agent sees a plugin's tool as `plugin__<id>__<tool>`, not `mcp__…`: it does not enter the project MCP palette and does not collide with an MCP server of the same name.

All three audiences are read through `PluginTools.of(projectId)` and stand empty in a project where the plugin is not enabled:
- `agents` — deferred through the `plugins` capability (the `tagma` agent and file-declared ones).
- `own` — through the `plugin:<id>` capability of the plugin's own agents.
- `view` — MCP descriptors as is, only for the view bridge: a view tool needs no model, so `visibility: ["app"]` does not drop it. No path hands it to agents.

Three cases refuse registration, so nothing promised silently disappears:
- a tool named in the manifest but not handed over by the process;
- a name past the 64 characters a model accepts;
- a tool from `agents` or `own` the model catalog will not accept (`visibility` without a model, tasks, names).

A process tool with no manifest record reaches nobody. `mutates` derives from the descriptor's `readOnlyHint`: without it the tool asks the operator in review mode — so ordering consent arrives with no new mechanism.
