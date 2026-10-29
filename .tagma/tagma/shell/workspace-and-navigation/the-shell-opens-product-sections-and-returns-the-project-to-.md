---
id: 01a14c05-9e8f-7c75-a633-b2a3d7370c0e
title: The shell opens product sections and returns the project to its last place with its branch
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a2b526a4f0
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/BackForward.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/NavigationRail.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/Selection.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/surface.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/Visits.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/routes/+page.ts
---
**Value.** The operator moves between product sections and returns the project to where they stopped, with no thread or block search again.

**How.** The section rail, project list, direct URLs and the start page; on desktop — history arrows, keyboard, extra mouse buttons and trackpad swipe on macOS: an arrow at the edge shows the step until fingers release.

**Behaviour.** The shell assembles sections and columns from owner declarations, highlights the current section and can hide its column. For a project the last portable place and branch are remembered, by project id; entering the project restores them. A window at a renamed project's address moves to the new name as soon as it learns it from the registry, and the whole move stays on the same project: the open page and columns do not rebuild. The app root opens the remembered project, otherwise an available plain project; an empty installation shows the start screen.

**Limits.** History uses the window history, not a separate Tagma-action journal. App sections do not carry over when restoring another project's place. Project registration, section contents and worktree choice belong to their areas.
