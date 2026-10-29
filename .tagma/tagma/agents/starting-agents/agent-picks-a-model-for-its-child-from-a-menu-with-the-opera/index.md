---
id: 01a14bae-6720-7d62-897a-92819bf508ea
title: Agent picks a model for its child from a menu with the operator's marks and moves the child to another model
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9280825673b8
  - kind: supersedes
    to: 01a14b6d-b1fe-71c8-aaa6-b796efa5544f
sources:
  - kind: file
    ref: packages/agent/src/collaboration/CollaborationVoice.ts
  - kind: file
    ref: packages/agent/src/collaboration/modelChoice.ts
  - kind: file
    ref: packages/agent/src/collaboration/treeActs.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: modelGuidance
  - kind: symbol
    ref: packages/agent/src/collaboration/CollaborationTools.ts
    symbol: collaborationTools
  - kind: symbol
    ref: packages/agent/src/collaboration/modelMenu.ts
    symbol: modelMenu
---
**Value.** The agent picks a model for its child from the operator's marks of what each model is for, not at random, and moves the child away from a provider where the failure repeats.

**How.** The `read_models` and `set_agent_model` tools; the marks — the `agent.modelGuidance` setting.

**Behaviour.** The menu names the models a child can run on, their rungs and switches, the operator's marks, and what is available only on the operator's word. The collaboration voice tells it to inherit the model by default and not to change it for variety. An inherited operator-only choice is downgraded, and the launch answer names the downgrade. A working child moves at a step boundary, a stopped one waits for continuation; a native child moves to any model, Claude Code included.

**Limits.** A CLI agent stays on its provider. Another's thread — only with the operator's consent; the agent does not move its own running thread that way.
