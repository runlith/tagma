---
id: 01a14293-472d-70a8-b91d-b08756e281ef
title: The block page builds on the live tree row, and a trashed block shows an in-place "in trash" state
ord: 14
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14275-468b-784f-8bfb-85ab57b460ff
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/BlockPage.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/Subject.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/rules/Engine.svelte
---
The page root is the live tree row (`TreeScreen.root`), and until the project tree arrives — the row from the same block's `read_block` answer: the page does not wait for the whole project to be read to show one block; breadcrumbs and the outline complete it when the tree arrives. The root is never a diff-lens ghost: `store.block` mixes deleted rows from the lens result, and a lens depending on such a root switched its own dependency — success put the deleted root into ghosts, cleanup removed it — and on every round sent `read_block_diff` and `read_block`.

The page stands in one frame once the root has a `read_block` answer: the tree row carries no body, and the header with the outline shown from it earlier received the body, facts, and links inserted above the outline — the page jumped. A cached request answer with the same `updatedAt` as the live row shows at once, but `Subject` still re-reads the block: link and anchor `updatedAt` do not move it. While no answer exists, the waiting mark appears only after 400 ms, so as not to flash on a fast answer. A page opened straight into diff first stands when the lens answers too: otherwise the current body would be replaced by a diff card of another height. A section a feature contributes may read on its own — the rule's check (`Engine`) — so it declares `ready` in `BlockSections`, and the page holds its first frame until every such read answers or refuses: a rule page stands in one frame in the main pane and in a tab alike. The hold reads the same keyed query the section then shows, through its observer, not a separate `load()` — otherwise the observer would re-read the just-arrived answer. Without Svelte's async mode nothing holds a mounting update whole, so the page holds it.

When `read_block` answers before the project tree, the page shows the block, and everything the tree adds — filter, outline, and links — appears in one piece below once the tree answers about the root. Breadcrumbs hold their place with a row of the same height when the root has a parent: otherwise their arrival with the tree would shift the page down.

The page subject keeps the requested address separate from the full identity returned by `read_block`; an answer is accepted only while its own request is still current. The live tree keys rows and parents by identity so colliding short names stay distinct. A copy-scoped row key correlates a changed row with the row it replaces, but a departure's renamed trash row is not the original subject. A resync discards the prior subject until its copy is read again. `Subject` starts one request at a time; a name shift, a live-row `updatedAt` shift, or a feed staleness mark asks again. A (name, stamp, mark) set whose answer already settled is not asked again, so a standing refusal does not loop.

Chrome claims — the top-row title (`Bar.name`) and the theme for `Mod+I` (`Topics.offer`) — are placed by the route (`/[project]` and `/b/[id]`, the `PageClaims` component) from the `read` the page exposes outward by binding and which may become `null`, not by the page itself or a child component by its own prop. The route — because the same page stands as a thread-block tab in the right area (`aside`), where it must not steal the thread's window title. The `{#if bar.title …}` block in `TopBar` stands earlier in the tree than the page and updates before its `{#if read}` branch is removed; a closure over a child component's prop read `null.title` outside the page boundary, and deleting the open block crashed the whole window, so the claim reads `read?.title`.

`deleted` and `not-found` are page states even when the block was already shown: deletion arrives as a feed frame or is found after resync when the row is gone from the tree. A trashed block opened with an explicit numeric journal range reads and shows that range inside the trash state, without making its diff row the page root. Another refusal with a shown block keeps the contents and goes to the error list, not a toast: the re-read was not the operator's act; with no shown block that is a "could not read" state with a retry.
