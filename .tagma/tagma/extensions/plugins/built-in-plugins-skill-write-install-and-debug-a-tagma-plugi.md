---
id: 01a15b25-56a4-7f05-afb9-23300d48f106
title: "Built-in `plugins` skill: write, install, and debug a Tagma plugin"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ad2-fa1d-7945-9154-76e975b1e908",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b08cea36cd32
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b09415a61526
---
The `## Plugins` section in the prompt gives only the manifest envelope and the installation operations: the view protocol (MCP Apps and `tagma/*` methods), `_meta['runlith/caller']`, the Tagma operations open to the process, the `results`/`pins`/`on`/`notify`/`schedule`/`secrets`/`agents` points, and debugging are explained to no agent anywhere. The skill is a `native-harness/skills/plugins/` folder modelled on `rules`, the prompt section shrinks to a pointer with a link to the skill, and the rule keeps the skill current when the plugin mechanism changes.
