---
id: 01a14c0c-6747-7325-a0f7-f79c508c4ca4
title: "Opening a block answers the press at once and shows contents in tens of milliseconds: the name address from the copy index, the card with the address from the answer, the page from one block"
ord: 69
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a11b65-f219-70d5-8e2c-66aac7c0b002
  - kind: relates
    to: 01a14bf1-c8c1-7ce0-9d6e-628bc57e2aa9
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/BlockPage.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/BlockTitles.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/BlockCard.svelte
  - kind: file
    ref: apps/tagma/server/src/graph/serving/copyIndex.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/crossing.ts
    symbol: locate
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/routing.ts
    symbol: titlesAcross
---
Opening a block — clicking a card in the feed, a `[[name]]` link, an outline row, a search result, a journal link, a knowledge column, or a map — answers the press at once and shows contents in tens of milliseconds at any graph and project-copy count on the machine, including a block of another project or global. The law is [[c57e2aa9]].

## What was measured

**Operator's machine, 2026-10-17 22:15:12Z (live server, one sample).** The `create_block` card in the runlith thread feed named global rule 698f3353. Two `read_titles` at that moment took 15.8 s and 14.1 s (span `3fd02783e65bf616`): `GraphPool.titlesAcross` read 21 cold copies at 0.6–1.2 s each — shadow-git attach (about a dozen git processes at ~12 ms), topology preparation, and a full tree walk of the copy in a worker — plus `git worktree list` per project (11–36 ms). Over the hour at 22:00Z — 49 `read_titles` calls totalling 33 s.

**Trial server (`tagma:try`, its own root, port 48620; 8 projects: team graph 16.7k blocks with three worktrees, five stealth projects with worktrees, global).**
- `read_titles` of a global name from the big project: p50 2.64 s, max 3.66 s (n=5); a dead name — 2.72 s (n=3); the same name from global itself — 3 ms.
- Browser, link to a global rule in a big-project block body, click to search answer: no reaction for 12.0 s and 9.0 s, then an immediate URL change and contents 150 ms after it.
- Click on an already resolved link: URL 68 ms, contents 378 ms.
- `read_block` in a copy the server had not opened yet (no mirror, full 16.7k-block assembly): 8.7 s; `read_tree` there — 4.7 s.

## Cause chain and its owners

1. **Click without feedback** — app link components (`BlockCard`, `BlockRefText`, `MarkdownBody`, the body-editor link). While the name search has no answer the link has no address; the click parks waiting in `BlockTitles.open` and shows nothing.
2. **The card waits for a search although it has the address** — the thread feed. The write answer carries `graphCopy` (project and checkout), read rows carry `projectId`; the card does not take them and asks the name search.
3. **Name search is a full walk** — `graph/serving`: `titlesAcross` and `GraphPool.titles`. On every call each copy the pool does not hold is read from files anew: the cost grows with blocks × copies and repeats on every batch of names. Yet every copy the server has served has a mirror with a `block_name_idx` index on the name tail, and that index was unused.
4. **An operation by a foreign name opens every project's graph** — `crossing.elsewhere`: to judge ambiguity it opens the full graph of every registered project (`OtherGraphs`) and holds it; after a server restart that is seconds per project.
5. **The page waits for the whole project tree** — `BlockPage`: it renders nothing until `ProjectTree` (the whole `read_tree` of the project) has the block's row, although the same block's `read_block` arrives earlier and carries all of its fields.

## Solution

**The name address comes from the copy index (`graph/serving`).** Search answers by index reads of every live mirror: one worker holds read-only mirror connections and answers the question by selecting on `block_name_idx`; the graph is not opened, the tree is not walked. Live copies are each project's main copy by the registry and worktrees from the project's checkout list (`Repo.checkoutsOf`); the list is read from its own owner without a git process until the repository's worktree metadata changes. Order and ambiguity are unchanged: the current copy, the other copies of the same project, then all copies of all other projects and global together — one name of two different blocks in one search level refuses with `ambiguous-name`.

`crossing.elsewhere` asks the same index and opens only projects whose main copy holds the name or has no index; a dead name opens no graph at all.

Rejected: a machine-wide "name → copy" table. It would be a second derivation of the fact the mirror of each copy already owns; it would have to be written in every act and every refresh of every graph, and it would go stale the same way.

Limits. A copy the server never served has no index: its names are found only after the copy is first opened. A cold copy's index reflects its last serving; a copy the pool holds is under a watcher and always current. This changes the earlier decision recorded in [[c7c0b002]]: a cold copy was read from files through topology preparation and graph steps, and the price — walking each copy's files on each search — breaks the law [[c57e2aa9]].

**The card takes the address from the answer (app, feed).** Writes — the project and branch from `graphCopy`; for the main checkout the branch is null, for another checkout its branch from the project's checkout list. Reads — the row's `projectId`: its own project opens in the current copy, another's in its main copy. The name search is needed for a list without an address and for an old write answer without a non-main-copy branch.

**Response to the press.** A link with a known address is ordinary navigation, the URL changes in the same frame. A link without an address gets the "opening" state at once on press (`aria-busy`, progress cursor, dimmed) and holds it until navigation or refusal.

**A page from one block.** `BlockPage` renders the title, status, body, and edges from the `read_block` answer as soon as it arrives; breadcrumbs and the subtree outline complete the page when the project tree arrives.

## Acceptance criteria

Measured on a trial server with the same fixture; on the operator's machine — after he restarts the server himself.

- Pressing any block link or card gives visible feedback (URL change or `aria-busy`) no later than the next frame (≤ 16 ms).
- `read_titles` of a global or another-project name from a foreign project: p95 < 100 ms (target 50–100 ms), ceiling 1 s; same for a dead name.
- Click on a global or another-project card or link → title and body on screen: p95 < 100 ms for a warm project, < 1 s for a cold project with a mirror.
- A block of the same project opens with contents in < 100 ms.
- An ambiguous short name between projects still refuses with `ambiguous-name`.

Outside this spec: first opening of a copy without a mirror (full mirror assembly from files) — owner [[1e154af5]].
