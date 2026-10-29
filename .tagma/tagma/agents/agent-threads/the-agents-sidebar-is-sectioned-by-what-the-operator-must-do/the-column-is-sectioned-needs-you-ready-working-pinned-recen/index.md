---
id: 01a0d136-c2b1-74b0-a32d-d96ca4acd1ed
title: The column is sectioned Needs you, Ready, Working, Pinned, Recent — asks from any depth and failed roots first, identical asks and one-act launches grouped
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
**Outcome.** The column is sectioned top to bottom by what the operator must do: **Needs you**, **Ready**, **Working**, **Pinned** and **Recent**. Archived becomes a quiet footer link with a count. Pinning is no longer needed to keep live work visible.

**Problem.** Problems 8 and 10 of [[f943c3ed]]. Beyond them, the question "who waits on me" is answered today only by two header counts that jump to one row at a time ([[a3ff5c5c]]).

**Holds now.**
- `threadTree.ts` bands the roots: `bandRoots` orders live by oldest spell and quiet by newest last event, and `pinRoots` lifts pins.
- `columnEntries` draws a pinned header and hairlines.
- `attentionOf` counts working, awaiting and unseen threads. `ThreadAttention.svelte` shows working and awaiting.
- `ThreadColumn.svelte` draws the archived section as a folded foot with its own list.
- The seen receipt is `ThreadList.seeOpenOutcome`, through the `see` operation per run.

## Target
**Placement.** Each root stands in exactly one section: the first of these that holds.
1. **Needs you**, where the root itself waits on the operator (an ask), or where its last outcome is failed or cut, not yet seen, and it is not working.
2. **Ready**, where its last outcome is completed and unseen (`outcome.isSeen` is false) and nothing in its tree is live.
3. **Working**, where the tree is live (the rule of [[e720da61]] and [[d8664aa0]]).
4. **Pinned**, where `pinnedAt` is set.
5. **Recent**, for the rest.

A root carries its tree wherever it stands. A pinned root wears a pin mark in every section.

### Needs you
It also holds a shortcut row for every non-root thread, at any depth, that waits on the operator. The shortcut carries a crumb, "root › parent", and the thread stays in its tree too. A failed or cut child never appears here ([[e08ed2e3]]).

- **Order:** by when the wait began (`ask.askedAt` when carried, otherwise the run's start), oldest first. A new item joins at the foot, so the rows never jump under the hand.
- **Ask groups:** more than 3 waiting threads of one team (the same `spawnRootId`) with the same `ask.key` ([[595698df]]) collapse into one row: "N asks", with the ask's first line.
  - It offers "Review one by one", which expands the member rows.
  - Where the ask is a tool confirmation (`ask.kind` is `confirm`), it also offers "Allow all N".
  - Allow all sends one answer per thread through the existing answer operations (`answer` for a native run, `answer_ask` for a harness). Each is its own trip, and each member leaves the group when the feed brings its answered row.

### Ready
- **Order:** by finish time, newest first.
- **Cut:** the first 5 rows are shown, followed by "N more", which expands the rest, and "Mark all read".
- **Mark all read** writes one seen receipt per root in view, through the `see` operation, each its own trip.
- **Leaving Ready:** opening the thread marks it read, as today ([[a1c88825]]), and the row moves to Recent.
- **Launch groups:** roots born by one act share `bornOf` ([[ddba1d6c]]). More than one such root collapses into ONE row in the section where the group stands: "Title ×N · a done · b failed", or "· c working" while working.
  - The group stands in Working while any member is live, and otherwise in Ready while any member is unseen.
  - Its failed and cut members are counted on the group row and do not appear separately in Needs you.
  - Opening the group row expands its members. "Mark all read" on it marks every member.
  - The title is the members' shared title, or else the first member's.

### Working
Live trees, ordered as today's live band: oldest spell first, and a waking tree joins at the foot ([[33db08d4]], [[0ea062c7]], [[98c37bd6]], [[96923ad3]]).

### Pinned
Pinned trees that stand in no earlier section, in arrival order. The section folds by its header ([[81f380be]]), and the header keeps "Unpin quiet" ([[d6415e4c]]).

### Recent
Quiet roots, by last event newest first ([[f3ee0232]], [[2daad7a5]]).
- Roots whose last event is on or after today's local midnight show.
- Older roots fold into "Earlier · N". It starts closed, and its state is remembered per project like the other folds.
- "N more" paging of the window stays at its foot ([[752ec867]]).

### Other surfaces
- **Section headers** use sentence-case labels ([[3734162e]]) with a tabular count. An empty section draws nothing.
- **The column header counts** are "Needs you N" and "Working N". Each counts threads, each thread once, so a child in a shortcut and in its tree counts once.
- **Archived:** a quiet footer link, "Archived · N". It opens the archived set in place of the list, with a way back. The set is still read on demand ([[99ea89ba]]).

### Keyboard
- ↑↓ or J/K: move between rows.
- →/←: expand or collapse.
- ↵: open.
- Space: peek ([[fd277fc5]]).
- A: jump to the next waiting item, walking Needs you in order and wrapping. It opens folds and clears a filter that hides the item, as [[a3ff5c5c]] does.
- /: filter.
- P: pin or unpin the row's tree.
- E: archive the row's thread, as the menu does.

None of these fires from an editable.

**Owners.** [[2028d329]]:
- `threadTree.ts`: section placement, groups and counts; `columnEntries` is replaced;
- `ThreadColumn.svelte`, `ThreadAttention.svelte` and `threadFolds.svelte.ts` (the Earlier fold);
- `ThreadList.svelte.ts` (Mark all read).

**Rejected.**
- A section per state for children: a failed or finished child belongs to its parent.
- Grouping asks across teams: the same words in two teams are not one decision.
- Allow all on free questions: a question's answer is not "allow".

**Acceptance**, on the page's data:
- 12 children asking the same confirmation show one row, "12 asks", with Allow all 12. Pressing it answers all 12, and the header count falls as their rows arrive.
- 30 roots born by one act and all finished show one Ready row, "Research ×30 · 28 done · 2 failed", and nothing of it in Needs you.
- 30 hand-launched finished roots show 5 rows, "25 more" and Mark all read.
- A working pinned tree stands in Working with a pin mark.
- `A` cycles through every waiting item.
- A failed root stands in Needs you until it is opened, and then in Recent.

**Claims touched.** As sentenced in [[f943c3ed]]:
- Dies: [[c72f883d]], [[dcabeed4]], [[5179f879]], [[6c03a7fe]], [[e65c9e2d]].
- Absorbed: [[33db08d4]], [[0ea062c7]], [[98c37bd6]], [[96923ad3]], [[f3ee0232]], [[2daad7a5]], [[a1a114f7]], [[8192d15c]], [[a3ff5c5c]], [[81f380be]], [[47aff579]], [[d6415e4c]].

**Order.**
- [[577af042]] can start at once. Without the new fields it orders Needs you by the run's start, and every ask is its own row.
- [[6baeb699]] waits on [[8847ca6b]] (`ask.key`, `ask.kind`) and on [[37a0a3ab]] (`bornOf`).

- **10. Contract:** it reads `ask`, `saidLine` and `bornOf` when present, and absent means ungrouped.
- **11. Stored data:** out, beyond one new browser mark for Earlier's fold.
- **12. Who may do what:** Allow all and Mark all read call the existing `answer`, `answer_ask` and `see` operations per thread, and those operations judge each call. A refusal on one leaves the others standing and speaks through the failure channel.
- **13. Long-lived things:** the group expansions live for the tab, and Earlier's fold is per project.
- **14. Bounded resources:** Ready 5, asks grouped past 3, and the window of 50 roots unchanged. Allow all sends N answers with no concurrency cap beyond the browser's, because N is bounded by one team's waiting threads.
- **15. Rollout:** a client-only change over optional fields.
- **16. Failures:**
  - A frame arriving mid-Allow-all moves members out one by one.
  - A dropped connection re-reads the window as today, and the sections re-derive.
  - Two operators answering one ask: the second is refused by the answer's claim ([[c09dda3c]]).
- **17. Observability:** the header counts equal the number of Needs you and Working threads on the page's 30-agent data.
