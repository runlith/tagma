---
id: 01a18492-1ee9-74de-95b0-7ca762f92536
title: The graph root is presented as its project by the registry label; the root block's title is graph content and never follows a rename
ord: 16
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/BlockPage.svelte
---
The root's breadcrumb step and the root page's header mark stand for the project, so they read `labelOf(project)`, the source the picker and rail read: a rename through `update_project` shows there at once, and the cross-project graph reads "Shared graph". The root block is seeded with the project name at birth, and its title stays an ordinary, editable title the page heading shows.

Syncing that title on rename was rejected. In a team project the root lives in a committed file under `.tagma/`, shared by clones that each machine may register under its own name, and the tree's directory names derive from titles: a local label would rewrite a shared file and move the tree.