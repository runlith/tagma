---
id: 01a14c08-8335-7c28-8f6b-267cdc8d5770
title: The operator sees which skills the agent will get in this checkout and where each comes from, and turns off the extras
ord: 2
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14c08-8335-7c28-8f6b-267b0bb6f81f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/SkillsSection.svelte
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/inputs.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/skills.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/inputs/operations.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/operations.ts
---
**Value.** The operator sees which skills the agent will get in this checkout and where each came from, and removes the extras without touching files.

**How.** Settings → Skills: skills in groups "this project", one "from <member> in this group" per other member of the project's group, "yours, everywhere", "from plugins enabled here", "built into the server", with path and description, a toggle per skill, files rejected with a reason, and a Re-read button; below — source settings. The same data is answered by `read_workspace_sources` and `reload_workspace_sources`; `read_agent_skills` answers the catalog of a specific thread or agent type (read by the composer and the agent library). All three are operator-only.

**Behaviour.**
- Disabling writes the name into `skills.disabled` of the selected layer; layers merge.
- A skill that Tagma itself puts into the repository for foreign CLIs is not offered to the native agent by default; `skills.own.enabled` hands it to it too.
- Re-read drops the cached project walk; the cache only lives while `skills.rescan` is not "every turn".

**Limits and divergences from the code.**
- The screen shows built-in skills as "Always", "Off" or "Replaced" (disabled, with a same-named skill standing in) with no toggle: only `skills.disabled` disables them.
- The toggle writes into `skills.disabled` not one name but all currently disabled skills — including Tagma's own skill, disabled only by the `skills.own.enabled` setting, and, when writing into the user layer, ones disabled in the project. Enabling `skills.own.enabled` after such a toggle will not bring the skill back. Read from the `SkillsSection.svelte` code, not reproduced.
- Instruction files found by the walk are not shown by the screen, although the answer carries them.
