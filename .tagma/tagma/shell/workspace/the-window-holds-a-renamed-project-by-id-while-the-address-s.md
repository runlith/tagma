---
id: 01a17b06-a309-7344-b5f3-d327e24d8f5f
title: The window holds a renamed project by id while the address still names its old name
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/Selection.svelte.ts
---
The registry receives the new name at once, and the window address moves to it via a navigation that lands later. If the active project is looked up only by the name from the address in between, the project vanishes for the transition: the project page unmounts, the main thread yields its place, and the agents column with everything held on the open project rebuilds. So `Workspace`, when moving the address to the new name, remembers the old name next to the project id, and `Workspace.named` answers by it — both for the path's project and for settings `?project=` — while the address names it; a second rename before the address arrives carries that old name along too. The record is dropped when the navigation `Workspace` started has finished and the address already names a different name; if the transition fails, the window stays on the same project under the old address. A name the registry now gives to another project beats the remembered one: the project that took the freed name gets its own address.
