---
id: 01a0cac8-1a35-73a4-a112-686d37be8466
title: "RowsControl discards a dirty draft on any catalog take: no dirty guard on its rebuild"
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/settings/controls/RowsControl.svelte
---
`RowsControl`'s `$effect` unconditionally rebuilds `draft` from props and clears `dirty` (`RowsControl.svelte:61-64`), with no dirty guard — unlike `ListEditor` (`ListEditor.svelte:43-46`). Any successful catalog take replaces entry/layer identities (`SettingsCatalog.svelte.ts:155-173`): a write landing on any key, or a reload, discards a dirty rows edit in progress.

Guard the rebuild on a clean draft like the list editor does. Done when an unrelated take no longer discards an in-progress rows edit, with a test pinning the dirty case.