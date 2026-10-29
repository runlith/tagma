---
id: 01a10891-853e-7f52-89f5-9e27cfd75516
title: "Tagma app shell: thin header, permanent rail, panels beside, one search, one visual standard"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/app/chrome
  - kind: file
    ref: apps/tagma/app/src/routes/+layout.svelte
---
The Tagma app window gets a tool shell instead of a site shell. On top a thin 36 px header with project, branch, search, “Attention” and menu. On the left a permanent five-section rail and a section column that can be hidden. Several threads, or a thread next to an object, show as panels. One ⌘K searches everything. All visuals follow one standard, held by a commit-time check.

Decided by the operator on 2026-10-04 from the “Tagma shell” page (http://localhost:5634/a/84de6e1a5397): an audit with screenshots, a review of third-party products, and mockups there.

## Why

In a month Tagma grew from an outliner into a workplace for dozens of agents, with no overall shell pass. Measurements of 2026-10-04 on live runlith, 1440×900, one sample:
- **84–117 px of chrome above a thread's first message** in three strips of different heights: 52 header, 32 thread title and 33 team strip.
- **Nearly everything in the header is rare.** Brand, “Search blocks” button, chat-popup switch, settings and theme; the middle about 780 px wide stands empty.
- **Always one thread on screen.** The chat popup (Dock) repeats the thread title and covers the status bar.
- **⌘K searches only blocks.**
- **Status bar:** numbers without labels, branch shown twice.
- **Rail changes shape.** Under Outline a Map, Graph, Rules subgroup and a column button appear. On `/rules` it disappears and no rail item is highlighted.
- **Map on open is a pixel-wide strip.**
- **Journal without a title.** It holds op codes, hex author ids and ~2:1-contrast time.
- **Visuals not assembled:**
  - 577 arbitrary font sizes out of 1069;
  - 13 effective radii;
  - five strip heights;
  - 34% of indents off-grid;
  - chrome lighter than content, so only lines divide panels.

## Decisions

- **Thin header stays.** It gives the global a permanent place independent of column and section. The headerless variant, with project and search moved into the column, was rejected: it wins only 32 px, while the global starts moving with the column, and on Mac the window buttons have nowhere to stand with a hidden column.
- **No tabs on top.** The sidebar is the list of all work, the team strip its second copy, tabs would be a third. Panels opened from the list, the team and the object put several threads on screen.
- **Team strip folds** into one button in the thread title.
- **Rail permanent:** Agents, Knowledge, Checkout, Journal, Rules. Map is removed, Graph becomes a view inside Knowledge.
- **Theme** is an app-menu item: System, Light or Dark, still in the browser.
- **New interface words are written in English**, like the whole interface now.

## Parts

- [[69cfbc5c]] — visual standard and commit-time check.
- [[54780672]] — header, rail, app menu, thread title.
- [[63cec91b]] — status bar.
- [[0ed5d929]] — one ⌘K search and question to the agent.
- [[8f3cc5fd]] — “Attention” across projects.
- [[5c88840b]] — panels, hiding the agents column, removing the chat popup.
- [[46f2f6ef]] — Knowledge section: column, view switch, Map removal.
- [[c33befa7]] — Journal.

## Order

1. [[69cfbc5c]] — first: later parts are written in tokens at once, and the check keeps variety from returning.
2. [[54780672]] — the header gains spots for “Attention” and the menu, and the rail a column-hiding button the panels need.
3. Then in parallel: [[5c88840b]], [[63cec91b]], [[0ed5d929]], [[8f3cc5fd]], [[46f2f6ef]], [[c33befa7]]. “Ask the agent” from [[0ed5d929]] opens the answer as a panel once [[5c88840b]] exists, and before that — as a plain move into a new thread.

## Out of the spec

- **New visual direction**: palette, accent color, fonts, density. A separate operator decision; this assembles what exists.
- **Popping a panel out into a separate desktop window.** Needs new Electron main-process code; the operator decides.
- **File search.** The app has no arbitrary-file view.
- **Semantic search** — [[5ce71527]].
- **Product rename.**

## Acceptance overall

- 68 px above a thread's first message with any team: 36 header and 32 thread title.
- The standard check passes over its whole area with zero debt.
- Every function of the current shell has a home. The list is in “Where it moves” under [[54780672]].
- Every section shot in both themes before and after, and the operator viewed the shots.
