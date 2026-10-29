---
id: 01a11792-a345-78e4-8aa7-842f55333c0f
title: A thread row in the agents column squeezes by real space, evenly per nesting level, and the name never reaches zero
ord: 18
tags: ["task"]
fields:
  {
    "holder": "tagma:01a116c3-516d-70a8-874e-1b9e71520d43",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Row.svelte
---
The `@container` thresholds of the column (249/289/339/399 px) at the thread row's icons are replaced by squeezing on real space. The column computes, for each nesting level (indent from a folder or a subagent), the lightest step at which every level row keeps about 6 name characters; deeper never shows lighter than shallower. The hiding order stays: reasoning level, model name, worktree, context ring (the hot one stays), files, provider mark. The worktree name in the badge cuts from the start by segments: `…intake` instead of `changes-inta…`.

Why: at ~420 px a subagent row with files, terminals and a worktree gives the name 0 px — thresholds know neither depth nor the icon set in the row.

Where: `apps/tagma/app/src/lib/features/threads/Row.svelte`, `native/ModelPlate.svelte`, `worktrees/PlaceBadge.svelte`, `Column.svelte`, `ArchivedFoot.svelte`.

Done when: the app typecheck is clean; in a 300–420 px column a subagent name is visible, and same-level rows show the same icon set.
