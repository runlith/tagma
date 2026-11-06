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

The tools agents and views are offered are built from the manifest's `tools` entries — name, description, input schema, annotations — so they stand before the plugin's process ever runs; a process whose `tools/list` differs is refused when it opens (explanation 38074044). All three offered audiences are read through `PluginTools.of(projectId)` and stand empty in a project where the plugin is not enabled:
- `agents` — deferred through the `plugins` capability (the `tagma` agent and file-declared ones).
- `own` — through the `plugin:<id>` capability of the plugin's own agents.
- `view` — MCP descriptors as is, only for the view bridge. No path hands it to agents.

The fourth audience, `tagma`, reaches nobody: it names a tool only Tagma calls for a point — a tick, an ending, a notification answer, a build step — and a point naming any other tool refuses the install, through the `tools` face's `serves`.

Nothing promised silently disappears. A name past the 64 characters a model accepts refuses the install, through the `tools` face's own check. A tool from `agents` or `own` that the model catalog will not accept (tasks, names) refuses its registration at publication.

While the plugin's process is `failed`, its `agents` and `own` tools are withdrawn from every catalog, so no agent is shown a tool that cannot run; they return when a process opens cleanly. `mutates` derives from the entry's `readOnlyHint`: without it the tool asks the operator in review mode — so ordering consent arrives with no new mechanism.
