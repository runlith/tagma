---
id: 01a0cac8-3634-7a81-bcfa-ddd98956747a
title: The section banner re-authors the decided sentence and drifts from scopeLock on both arms
ord: 2
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/scope.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/SettingsPage.svelte
---
The section banner composes its own decided-sentence (`SettingsPage.svelte:133-136`): user-arm "for this machine" vs `scopeLock`'s "for every project", project-arm "per project" vs "in each project, separately" (`scope.ts:27`, user arm via `scopeName` at `:8`). The banner reintroduces "this machine", the stale name the rule retired.

Derive the banner's sentence from `scopeLock` (or the shared scope vocabulary) instead of composing a second one. Done when both arms agree word for word with the row lock.