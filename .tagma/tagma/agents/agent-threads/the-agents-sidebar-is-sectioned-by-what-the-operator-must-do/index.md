---
id: 01a0d136-c1a6-7dbb-b477-8dc4f943c3ed
title: The Agents sidebar is sectioned by what the operator must do, and every row says what its thread is doing now
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Divergence, 2026-09-24:** after using the built column, the operator took the sections back out. Needs you, Ready, Working, Pinned and Recent are gone, and with them the shortcut rows, "Mark all read", "Earlier", the "N asks" group rows and the "×N" launch rows. The column is the thread tree again ([[823bbb30]]). The row grammar, peek, team folding, team strip, row fields and birth fact below stand as built. Every mention of sections, Ready or groups below describes what was accepted and then withdrawn.

The operator accepted this on 2026-09-24, on the page "Сайдбар агентов" (http://localhost:5634/a/d919fe395c8e). Where that page and this spec differ, the operator's later corrections, as relayed, decide. Two changes are not in this spec. The typeface and sentence-case labels are [[3734162e]]. Worktrees get their own spec later; the only room kept for them here is an empty slot before a row's title, for a colour square.

## 1. Outcome
The Agents column answers four questions, most important first:
1. Who is waiting on me, and what is ready?
2. What is working, and what is each thread doing?
3. Where is the thread I want?
4. How is a team made up?

The column is split into sections by what the operator must do:
- **Needs you**
- **Ready**
- **Working**
- **Pinned**
- **Recent**
- Archived, reduced to a quiet footer link.

A row starts with its state and with what the thread is doing now. The model and the context ring stay on the row, drawn as right-aligned columns. Exact figures move to a peek. An expanded team shows only its live members. The open thread's header gets a strip that shows the whole team.

## 2. Problem, with its evidence
Measured on the operator's screenshot: 27 rows, and 19 of them read "Opus · XHigh". No row said what its thread was doing. The page numbers ten problems:
1. The labels are wide Archivo capitals, and Archivo has no Cyrillic. This is covered by [[3734162e]].
2. The model and rung repeat on every row. The few rows on another model (Grok, Step) get lost in the grey wall.
3. Each row carries five right-side marks: processes, files, model, context and time. The history icon means nothing without its tooltip.
4. The state dot encodes two things at once: its colour is the state and its fill is the cache warmth ([[c4f13097]]). Nobody reads the fill.
5. One parent showed 18 expanded children and none of them was working. Finished children fold only after 24 hours ([[9fd52b92]]). A review pair takes two separate rows.
6. Children wear the green "unread" dot, although their reports already went to their parent. The operator saw fourteen green dots on work nobody owed them.
7. A working row does not say what it is doing ([[d6a850aa]] keeps its second line empty).
8. Pinning is used as "my current work", and the Pinned band eats the list ([[dcabeed4]]).
9. Time is set in mono, so "53s" (running for) and "8m" (ago) differ only by colour.
10. Archived always takes a row at the foot and reads like another section ([[e65c9e2d]]).

## 3. What holds now
Checked against `apps/tagma/app/src/lib/features/harness` and the server row on 2026-09-24.
- **Order.** `ThreadList.tree` composes `pinRoots(bandRoots(threadTree(rows)))`. Pinned trees stand first, then live trees (oldest spell first), then quiet trees (newest last event first). The column draws a pinned band header and hairlines between bands.
- **Rows.** `ThreadRow` draws:
  - the `ThreadLife` mark, whose tone is the state and whose fill is the cache;
  - the title for a root, or the agent name for a child;
  - `ActivityBadge`: a spinner and count, a warning, or a history icon;
  - the held-files count;
  - `ModelPlate`: the glyph, the short model name and the rung;
  - `ContextRing`, red only at 100%;
  - a mono stamp;
  - a second line only at rest: waiting, cut or failed.
- **Folding.** `foldFinished` keeps idle children standing for 24 hours and then folds them into "N older".
- **Attention.** Attention counts working, awaiting and unseen threads at every depth. The header shows working and awaiting.
- **Server row.** It already carries: `life`, `activity.calls`, `heldPaths`, `contextShare`, `cacheWarmth`, `outcome` (with `isSeen` and `failure`), `provider`, `model`, `reasoning`, `activeRunSelection`, `account`, `harness.question`, `spawnRootId`, `parentThreadId`, `name`, `agentId`, `profileId`, `pinnedAt` and `liveSpellStartedAt`.
- **What the row lacks** is in [[595698df]] and [[ddba1d6c]].

## 4. Target model
Each part is its own decision:
- [[fd277fc5]]: the row grammar, width tiers and peek.
- [[e08ed2e3]]: team folding.
- [[a4acd1ed]]: the sections, with ask groups and launch groups.
- [[595698df]]: the row fields the server must add (the ask, the said line, context tokens).
- [[ddba1d6c]]: the fact of which act a thread was born by.
- [[6c0d60a2]]: the team strip in the thread header.

## 5. Owners and boundaries
- **UI:** [[2028d329]], in `apps/tagma/app/src/lib/features/harness`. The model plate and context ring are shared with [[aeb922f0]]; their claims are judged below.
- **Row fields:** [[edd4a99c]], which produces the row (`ThreadStore.summaries`, `ThreadList.ts` and `wire.ts#wireThread`).
- **Birth fact:** [[3ef6226b]], the spawn tree.

The UI derives sections, groups and folds from the rows alone. It never asks the server for a section.

## 6. Rejected alternatives
- **Variant A:** the tree alone with better rows. It still needs pins to keep live work in view, and it answers "who waits on me" only by scanning.
- **Variant C:** a card per team. Cards cost too much height in a sidebar. Their one good idea, live members as chips, became [[6c0d60a2]].
- **Effort as tick bars.** The operator rejected them. Effort is a lowercase word.
- **Keeping the 24-hour fold.** Finished children are noise the moment they finish.

## 7. Acceptance
Each child decision carries its own acceptance criteria. For the whole column:
- With the page's 30-agent load (12 identical asks, 30 roots from one act, a parent with 30 children), the column fits in one screen of about 20 rows, and every waiting item is reachable with `A`.
- No green dot stands on a child row.

## 8. What becomes of each claim, task and finding
Verdicts for the claims under [[2028d329]], and for the plate and ring claims under [[aeb922f0]]. A claim that dies is superseded, or rewritten from the new code by the task named with it. An absorbed claim is rewritten, by that task, into the claim its decision's truth stands on. A claim that survives is untouched.

**Dies with the redraw:**
- [[c72f883d]], the banded composition. Replaced by sections ([[577af042]]).
- [[dcabeed4]], a pin lifting a tree above every row. Pinned is now the fourth section ([[577af042]]).
- [[5179f879]], the folded pinned band drawing its live trees. Live pinned trees stand in Working ([[577af042]]) — withdrawn with the sections; the band stands again as [[79187c3e]].
- [[6c03a7fe]], only the pinned band taking a header. Every section has a header ([[577af042]]).
- [[9fd52b92]], the 24-hour fold ([[c6ba14e5]]).
- [[b0f9b795]], live children first and then recent children newest-first ([[c6ba14e5]]).
- [[d6a850aa]], the empty second line while working ([[79b59d15]]).
- [[c4f13097]], the mark's fill as the cache ([[79b59d15]]).
- [[59f79ad4]], the activity badge's standing rules. Only a running-process count remains, and it never drops ([[79b59d15]]).
- [[e65c9e2d]], the archived folded foot. It becomes a footer link ([[577af042]]).
- [[77e8586b]], the plate's parts appearing by width. Replaced by the new tiers ([[79b59d15]]).

**Absorbed:**
- Into [[577af042]]:
  - [[33db08d4]], [[0ea062c7]], [[98c37bd6]] and [[96923ad3]]: the live band's order, now Working's order.
  - [[f3ee0232]] and [[2daad7a5]]: the quiet order, now Recent's order.
  - [[a1a114f7]] and [[8192d15c]]: attention counts, now the Needs you and Working counts, each thread once.
  - [[a3ff5c5c]]: a header count jumps. Jumping now also comes from `A`.
  - [[81f380be]]: the pinned band folds by its own chevron, now the Pinned section header.
  - [[47aff579]]: the archive-open memory, now the archive view's.
  - [[d6415e4c]]: Unpin quiet, now on the Pinned header.
- Into [[c6ba14e5]]:
  - [[db76ba47]] and [[966100e0]]: what the fold chevron answers, now the collapsed team's counts.
  - [[8ccbf6dc]]: stubs start closed, now "N finished" starts closed.
- Into [[79b59d15]]:
  - [[8e5093bd]] and [[2b413c44]]: the mark's tones and beat, now the state dot table.
  - [[65ee6966]]: the harness ask in its own words, now the ask text for every waiting row.
  - [[f87ae17e]]: the stamp's clock, now amber, blue or grey.
  - [[5ccdc4e3]]: the held count, now a signal that drops below 290px.
  - [[e8a28eaf]]: the ring, now red from 80% with the cache dot at its centre.
- Into [[400289b2]]: [[35a9f05e]], where Space opened the activity panel. Space now opens the peek; the rest of that claim's keys survive.

**Survives:**
- The list's plumbing: [[7f68151b]], [[8f1be25c]], [[0350d8ea]], [[ae30fd82]], [[e2ce4a9a]], [[7c0aa280]], [[752ec867]], [[ac2182f7]], [[f5fc2d88]], [[92bf0489]], [[6e358071]], [[ccf2fdb2]], [[cd491dc5]].
- Acts: [[1a545d7b]], [[b4d210df]], [[244ea3e5]], [[03da7d11]], [[a3c38e48]], [[edcaf46a]], [[beef72d9]], [[be595fd1]].
- Receipts: [[a1c88825]], [[1f002fa4]], [[52a85028]], [[78973adf]], [[3abb44ca]]. "Mark all read" is an explicit press, so rendering still clears nothing.
- The archived set and folds: [[99ea89ba]], [[913a2021]], [[b76d4bfe]], [[e3c70b91]], [[58079d39]], [[32efdb2c]].
- Filtering: [[9886babe]], [[ad4ed85c]] (sections, "N finished" and "Earlier" also stand open while filtering), [[a83aa140]], [[2de3e637]], [[7bf7a51d]], [[3f4d7575]].
- Tree rules: [[a9df8461]], [[e720da61]], [[d8664aa0]], [[3d3f7f46]].
- Harness clocks and warmth: [[532f765f]], [[ff8197e5]] (it now drives the ring's centre dot), [[b2641335]], [[af5ae8d0]], [[0826e089]].
- The menu and the strip's identity: [[8aa36b42]], [[d278d530]], [[670a865d]], [[6ca607f1]], [[a17d18a9]], [[0fcb755a]], [[7a27a020]], [[dc8da19c]], [[02d6dbd4]], [[8cf9d4f1]], [[174734c9]], [[280295ea]], [[f37fbcc2]], [[8478b789]], [[b7a628f8]], [[72cd70cd]], [[cd253bf8]], [[1972b5b9]].
- Screen and activity: [[f4bdaac2]], [[c784cbe2]], [[9d44855a]], [[25c08be6]], [[f458498b]], [[501ae1f4]], [[9a0c803e]], [[1d429739]], [[7ed5da99]].
- Sends and links: [[272ef7c6]], [[3bbe7815]], [[e62583a7]], [[375fa6a5]].
- The plate's identity and selection under [[aeb922f0]]: [[fa608ffd]], [[0cf4087d]], [[ca2f29d1]].
- The rule [[46899e82]] binds every new control here: Allow all, Mark all read, the peek's actions.

**Task and findings:**
- [[7885ea52]], where `foldFinished` hides live work below a finished child, is absorbed by [[c6ba14e5]]: a child holding live descendants stands. Its builder closes the task by that task's commit.
- The 22 findings standing under [[2028d329]] are:
  - a drift on [[72cd70cd]];
  - a missing language reader on [[375fa6a5]];
  - baseline-stale stamps on files the typography build [[148cdcd4]] is rewriting now.

  They survive as that owner's re-reading. The findings on claims that die or are absorbed end with those claims in the tasks named above.

## 9. Order of building
[[79b59d15]] · [[c6ba14e5]] · [[577af042]] · [[8847ca6b]] · [[37a0a3ab]] (these five can start at once) → [[400289b2]] (after [[79b59d15]]) → [[6baeb699]] (waits on [[8847ca6b]] and [[37a0a3ab]]) · [[c50f5fd3]] (waits on [[37a0a3ab]])

## 10–17
- **10. Contract:** the row gains optional fields in [[595698df]] and [[ddba1d6c]]; nothing is removed. **11. Stored data:** one nullable column, in [[ddba1d6c]]. **12. Who may do what:** unchanged, because every act uses an existing operation; the peek and the group rows add no authority.
- **13. Long-lived things:** only the peek's open state and the section folds, which live in this browser like today's folds. **14. Bounded resources:** the window of 50 roots stays; sections cut rows by count (Ready 5, "N more working" past 5, asks grouped past 3). **15. Rollout:** a client without the new fields draws the rows it can, and running work is untouched. **16. Failures:** the feed and window reads are unchanged, so a dropped connection re-reads the window as today. **17. Observability:** each child names its own checks.

Items on the page that the accepted list does not carry are out: the density switch, the ⌘⇧G grouping switch (worktree spec), filtering by branch (worktree spec), and opening a launch group as a comparison (see [[3d2686de]]).
