---
id: 01a0d136-c286-7fd7-a1f3-6adde08ed2e3
title: An expanded parent shows only live children and folds every finished one at once into "N finished"; a collapsed parent shows its team's counts
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Outcome.** An expanded parent shows only its live children, in the order they were handed:
- working;
- asking;
- failed or cut;
- holding live descendants.

Everything finished folds at once into one "N finished" row. A collapsed parent shows its team's counts: working, asking and failed.

**Problem.** Problems 5 and 6 of [[f943c3ed]]: 18 finished children expanded under one parent, the 24-hour fold, and green "unread" dots on children whose reports went to their parent. The standing task [[7885ea52]] adds a defect: `foldFinished` judges a child by its own row alone, so a finished child holding working grandchildren is folded away.

**Holds now.**
- `threadTree.ts#foldFinished` splits children into alive (by the row's own life), recent (idle within 24 hours) and finished.
- `ThreadRow.svelte` draws standing children, then an "N older" stub that `ThreadFolds.toggleStub` opens.
- The chevron is toned by `node.lifeBelow`.

## Target
- **Standing children.** A child stands while any of these holds:
  - its own row is working or waiting;
  - its last outcome is failed or cut and its thread is idle;
  - `lifeBelow` is not idle;
  - a descendant is failed or cut.

  Standing children keep the handed order ([[3d3f7f46]]); nothing re-sorts them.
- **Failed children.** A failed or cut child stays red in its parent's tree, and never enters Needs you, because its parent already received the diagnosis as a report. It stops standing once its thread runs again or is archived. Only its parent or the operator decides what happens to it.
- **"N finished."** Every other child folds into one "N finished" row, which starts closed ([[8ccbf6dc]]). Opened, it lists the finished children in handed order.
- **"N more working."** When more than 5 plain-working children stand on one level, the first 5 are drawn, followed by one "N more working" row that opens the rest. A plain-working child is working with nothing waiting or failed below it. Waiting and failed children always draw.
- **A collapsed parent** draws its counts at the signals slot of [[fd277fc5]]: working (amber), asking (blue) and failed (red), each shown only above zero. They count every descendant, not only direct children. Its second line names who is working.
- **No green dot on children.** Ever. This comes from [[fd277fc5]]'s dot table.
- **The 24-hour rule** and `FOLD_AFTER_MS` go.

**Owners.** [[2028d329]]: `threadTree.ts` (`foldFinished` and a count of a node's team), `ThreadRow.svelte` and `threadFolds.svelte.ts`. The stored browser key of the stub is reused for "N finished".

**Rejected.**
- Keeping finished children for a day.
- Folding by the child's own row alone, which is the defect of [[7885ea52]].

**Acceptance.**
- A parent whose 30 children are all finished draws one "30 finished" row.
- With 2 failed, 24 working and 4 finished children, the expanded parent draws the 2 failed, the first 5 working, "19 more working" and "4 finished".
- A finished child with a working grandchild stands.
- A collapsed parent with 3 working and 1 asking descendant shows "3" amber and "1" blue.

**Claims touched.** As sentenced in [[f943c3ed]]:
- Dies: [[9fd52b92]], [[b0f9b795]].
- Absorbed: [[db76ba47]], [[966100e0]], [[8ccbf6dc]].
- Survives: [[3d3f7f46]], [[b76d4bfe]], [[913a2021]].
- [[7885ea52]] closes with [[c6ba14e5]]'s commit.

**Order.** [[c6ba14e5]]. It needs no server field.

- **10. Contract:** out, because this is client-only.
- **11. Stored data:** out. The existing per-project stub and fold keys are reused unchanged.
- **12. Who may do what:** out, because nothing acts.
- **13. Long-lived things:** open stubs persist per project, as today, and the "N more working" expansion lives for the tab.
- **14. Bounded resources:** 5 working rows per level before the cut, and one row for the rest.
- **15. Rollout:** out, because this is client-only.
- **16. Failures:** out, because it is derived from rows the feed already delivers.
- **17. Observability:** the acceptance cases on the page's 30-children data.
