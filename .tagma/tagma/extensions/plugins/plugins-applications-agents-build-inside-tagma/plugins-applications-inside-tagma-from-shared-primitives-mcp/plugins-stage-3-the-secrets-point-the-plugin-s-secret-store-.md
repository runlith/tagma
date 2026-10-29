---
id: 01a12395-9b58-78c0-9bc7-fedd1f6db033
title: "Plugins, stage 3: the secrets point — the plugin's secret store filled by the operator in settings, values in the process env and in the redactor"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12395-c3c5-763e-8ec3-0b0d4647905f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The spec's “Contribution points by stage” section → “Secrets”. The plugin declares the secrets it needs in the manifest (name and description); the operator fills the values in the plugin's settings; the supervisor hands the values to the process in env and registers them with the redactor, so a value never reaches the ribbon, logs, or tool answers. A value change restarts the process over six steps. The point is declared by the owner through `PluginPoints.declare`, `plugins` is untouched.

Done when an integration test shows: a declared secret with no value is visible as missing in the plugin's row; the operator-set value reaches the process in env; the tool output carrying that value arrives in the ribbon masked; a value change restarts the process exactly once. The settings field works on desktop and web.
