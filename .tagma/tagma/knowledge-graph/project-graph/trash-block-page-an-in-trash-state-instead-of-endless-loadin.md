---
id: 01a14275-468b-784f-8bfb-85ab57b460ff
title: "Trash block page: an \"in trash\" state instead of endless loading, diff lens without the request loop"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14258-6e1a-7a10-ad53-6a18e5dec83d",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/BlockPage.svelte
---
A block page opened on a trashed block (e.g. from a thread-feed card with `?diff=from..to`) hung on the spinner and sent requests without end, while the "Gate refused · deleted" notice ran into the hundreds.

Causes, found by reproducing at `127.0.0.1:5633/runlith/b/8b945719`:
- `read_block` refuses `deleted`, but the page only knew `not-found` — there was no "in trash" state, the refusal went to a notice, the page stayed on the spinner.
- The diff lens depended on the page root, and the root came from `store.block`, which mixes in lens ghosts: a successful `read_block_diff` put the deleted block into ghosts, cleanup removed it — the effect restarted itself; each round also called `read_block` (409). Without `?diff` the request is single; with `?diff=1..` — 23 pairs of `read_block` 409 + `read_block_diff` 200 within seconds.
- Block reads came from three effects with no shared answer ordering; opening a live block sent `read_block` twice.
- The `parent-deleted` refusal of `restore_block` named the parent by its internal numeric id instead of the block name.

To do:
- the page root is a live tree row (`TreeScreen.root`), never a lens ghost; the lens runs only for a live root;
- one read of the page subject with answer ordering: the last started wins; re-read when the live row changes or the feed brings links;
- while nothing is shown, a read failure is a page state: "in trash" (with restore), "no such block", "could not read" (with retry); an already shown block stays on re-read failure, and the refusal goes to a notice;
- a lens refusal shows in its band, not as an eternal "Reading the journal back…";
- `parent-deleted` names the parent by its block name.

Proof: on the same link with `?diff=` the page shows "in trash" and makes a finite number of requests; restoring opens the block; app and server typecheck green.

Result (21ae42387d): verified on the Vite dev server against the working server — a trashed block with `?diff=1..`: one `read_block` (409), no `read_block_diff` and no notices; a live block with `?diff=1..`: one `read_block` (was two) and one `read_block_diff`; deleting the open block by an agent shows "in trash" in place with no requests, Restore is one `restore_block`, a tree reload and one `read_block`. `trash.itest.ts` green. Not proven: typecheck — the app's `svelte-check`, even narrowed to changed files, does not fit the one-minute command rule 682290ec on a loaded machine; the Svelte files and the module compile without warnings.
