---
id: 01a14c37-8e27-74e9-a198-ca836db77cd1
title: The Skills screen must switch off one skill and show that built-ins switch off too
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14c08-8335-7c28-8f6b-267cdc8d5770
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings
---
Built-in skills are shown as "Always" with no toggle, although `skills.disabled` disables them. Toggling one skill writes into `skills.disabled` all currently disabled skills, including Tagma's own skill and ones shadowed by built-ins (`SkillsSection.svelte`). A reading from code — reproduce.
