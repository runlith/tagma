---
id: 01a1adea-b0d3-775f-bf15-52449ea86e20
title: "Step 2: the plugin SDK, create_plugin, contributions from the manifest and processes on demand"
ord: 4
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1ad4a-a9f0-7e77-9b01-4d7dd2b5f488
  - kind: relates
    to: 01a1ad53-a8b9-7fa9-98a0-71655067fa15
---
Step 2 of the plugins spec's order of work, with the SDK of [[5067fa15]]. Two parts share one contract — the manifest the SDK build writes, the process ↔ host protocol and the template door: the server part (manifest-published contributions, idle, on-demand and resident processes, the tools/list check, `create_plugin`, outdated builds, commit steps skipping generated files, the screen's words) and the SDK part in `packages/tagma` (`/plugin`, the runtime, the `tagma-plugin` bin, `/testing`, the template, the `plugins` skill). Views stay HTML pages until step 5. runlith's core-pin app is rebuilt on the SDK before the branch merges.