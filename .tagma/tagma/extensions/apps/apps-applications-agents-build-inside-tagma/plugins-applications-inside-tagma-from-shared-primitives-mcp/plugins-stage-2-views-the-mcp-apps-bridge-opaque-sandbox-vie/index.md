---
id: 01a12310-3d85-7ead-bc27-8764f3af6e52
title: "Plugins, stage 2: views — the MCP Apps bridge, opaque sandbox, views/results/pins/launchers, the window"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
Stage 2 of spec [[a0a16218]]. Parts independent of the `plugins` module run in parallel with stage 1: [[5e0589ab]], [[77af71a5]]. The rest is cut once stage 1 delivers the module.

For the `results` point: a step detail with a renderer mounts only expanded, and expanding by default in old stretches reaches only the newest call, and `ToolKind.open` does not change that. A plugin's view in a tool's result must be visible without expanding — the `results` task decides that.
