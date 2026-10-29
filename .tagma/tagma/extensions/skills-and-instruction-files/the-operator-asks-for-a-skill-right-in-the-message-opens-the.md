---
id: 01a14c08-8336-7b3c-965a-b08da15925d2
title: "The operator asks for a skill right in the message: $ opens the thread's skill catalog in the composer"
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-7595-7388-9467-c90f6d8a1c85
  - kind: relates
    to: 01a14c08-8335-7c28-8f6b-267b0bb6f81f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/SkillCatalog.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/skills.composer.svelte
  - kind: file
    ref: packages/agent/src/agent/agentSkillRequests.ts
  - kind: file
    ref: packages/agent/src/agent/skillReferences.ts
---
**Value.** The operator does not hope the agent will pick up a skill on its own, but asks for it directly in the message.

**How.** In the composer, `$` opens the catalog of skills this thread or the selected type's draft will get, with descriptions and search by name and description; the chosen skill is inserted as a `$name` reference and highlighted.

**Behaviour.**
- `$name` naming a skill from the catalog is an explicit request: the agent must load it before any other work, and the harness reminds it until the skill is loaded. A `$word` naming no skill is plain text.
- A name outside the inline grammar is written quoted (`$"Review Notes"`); `$` inside code, a `[[…]]` reference, or after a backslash is literal.
- The catalog is re-read when the thread's run calls tools, so a new skill appears without reloading the window.

**Limits.** Highlighting is only a request: the skill's instructions reach the model only once it calls `load_skill` itself. An agent thread without the `skills` capability shows an empty catalog with a note.
