---
id: 01a13de0-db67-7af3-8e3c-e8c9ee9a665a
title: "TagCatalog reads only the window project's dictionary: another project's thread ribbon in the side panel sees the wrong lifecycle"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18455-7bd6-7f11-b5c5-bceb41b92ba7",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/TagCatalog.svelte.ts
---
`TagCatalog` is an app-tier service with one dictionary that follows `workspace.contextProject`. Another project's thread panel ([[7d7a8fed]]) holds the home project, but `ThreadSlot` (`ComposerFeeds`), `BlockCard`, `ToolResultRow`, and `graphTools.feed` take the window's dictionary. When the home's tag has another lifecycle binding or a status field the window's dictionary does not know, the block's `statusOf`/`tagOf` answer wrong or `null`.

Do at the owner: the dictionary is read per project — a project tier or `of(projectId)` reads over keyed `TagsRepo.of` — and consumers inside a ribbon take the dictionary of their own scope. The palette (`CommandPalette`) and the other ~30 current consumers read the app-tier singleton, so this is separate work, not a panel fix. Done when a test with two projects with different lifecycle bindings shows the ribbon status from the home dictionary.
