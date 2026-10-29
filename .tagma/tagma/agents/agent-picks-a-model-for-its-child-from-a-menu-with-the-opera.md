---
id: 01a14b6d-b1fe-71c8-aaa6-b796efa5544f
title: Agent picks a model for its child from a menu with the operator's marks and moves the child to another model
ord: 12
---
An agent picks a model for its child not at random but from a menu where the operator wrote what each model is for, and can move the child to another model when the failure on the old one repeats.

**Menu.** The deferred `read_models` tool: models the child of this thread can run on, by provider, with the rung ladder, the operator-only mark and what such a rung downgrades to, switches with values, and the operator's text from the `agent.modelGuidance` setting ("what for" and "which rung to ask"; the last record for a pair wins, project answers over machine). The collaboration voice tells it by default to name no model and to inherit, to downgrade only bounded verifiable work, and not to change the model for variety.

**Choice at spawn.** `provider`, `model`, `reasoning`, and `switches` in `spawn_agent`; without them — the type-profile model, otherwise the parent's. Operator-only models and rungs like `max` go only on the operator's word: an inherited such choice is downgraded, and the spawn answer names the downgraded model and rung.

**Moving.** `set_agent_model` moves the child to another provider, model, or rung: a working child finishes the step and continues on it, a stopped one waits for `continue_agent`. A native child goes anywhere, Claude Code included; a CLI agent stays on its provider. Another's thread — only with the operator's consent (`not-a-child`); its own running thread — `self-move`. Refusals: `selection-empty`, `model-pinned`, `model-unnamed`, `model-unserved`, `reasoning-unoffered`.

Code: packages/agent/src/collaboration/modelMenu.ts#modelMenu, packages/agent/src/collaboration/CollaborationTools.ts#collaborationTools, apps/tagma/server/src/threads/contract/wire/settings.ts#modelGuidance, packages/agent/src/collaboration/CollaborationVoice.ts, packages/agent/src/collaboration/modelChoice.ts, packages/agent/src/collaboration/treeActs.ts
