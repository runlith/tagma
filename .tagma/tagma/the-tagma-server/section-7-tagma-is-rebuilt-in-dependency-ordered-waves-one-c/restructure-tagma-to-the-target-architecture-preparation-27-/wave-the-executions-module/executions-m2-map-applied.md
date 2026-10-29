---
id: 01a0e532-cb8a-7bef-9a85-b3ffc595c5f9
title: "executions M2: map applied"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e841-ca11-7a40-8e66-55d3d1aba29c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-cb81-7175-a49a-cfaddab0cf5c
---
§7.2.2 milestone `M2` of the `executions` card ([[f7e0b9dd]]), with its vocabulary amendment [[08edfbc5]].

Also owned here: after a build, the terminals floor replaces the host inside its own `replaceHost` and never through installation's `SuccessionSteps` hook, so installation M2's acceptance 4 ("the answer names the unbound step") cannot hold. Move that replacement onto `SuccessionSteps`. Executions fills the hook, and installation's build path yields it. Found by wave-platform at [[45779ef0]].