---
id: 01a10891-853e-7f52-89f5-9e2fc33befa7
title: "Journal reads: title, full width, days and absolute time, author by thread name, actions in words, repeats folded"
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/graph/journal
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/journal.ts
---
The journal reads as an event feed. It has a standard page title and full width, day dividers and absolute time. The author is named by thread name, actions in words, repeats of one block folded, filters looking like filters.

## What is there now

`lib/features/graph/journal/Page.svelte`:
- no title;
- a `max-w-[46rem]` column in the middle of 1392 px;
- a row is six ragged columns: the author icon shows only on session change, and names cut at 288 px;
- actions shown as `GRAPH_EVENT_OPS` codes: `anchor`, `remeasure`, `enforce`;
- author is 8 hex (`sessionName`);
- relative time at about 2:1 contrast, no days;
- one block repeats in consecutive rows;
- filters drawn as text.

## What we do

**Title.** `PageHeader` from [[69cfbc5c]]: `Journal`, caption `What was written to the <project> graph · N entries`, filters on the right. When opening `/journal/<block>`, a `ScopeChip` next to the title, as now.

**Width.** Wide page from [[69cfbc5c]].

**Row — a five-column table**
- Time: `HH:MM`, mono `text-meta`, normal contrast; full date in the tooltip.
- Author: thread name with agent icon. Other CLIs keep their mark, as now.
- Action in words, through interface translations.
- Block: state dot, monochrome type icon, name across the full remaining width.
- Block id.

The author icon is in every row. Unread is highlighted, as now.

**Days.** `Today`, `Yesterday` dividers, then the date.

**Folding repeats.** Consecutive batches by one author on one block fold into one row with `×N`. Expanding shows each batch's diff, as now.

**Actions in words.** Every op of `GRAPH_EVENT_OPS` gets a short verb: created, edited, claimed, released, finished, closed, linked, anchored to N files, rule enforced, remeasured, answered, superseded, and so on. The table lives next to the journal in the app, one row per op; a new op without a row shows its code, not emptiness.

**Filters** — standard 28-high bordered controls: Types, Threads, Actions, plus reset. The server already accepts tags, sessions and ops.

## Author name — data

A journal session `JournalSession {id, harness, key}` carries no name. For the `tagma` harness the key is the thread id, but the client `ThreadList` is paged, and archived threads may not be in it.
- The graph module declares a session-names port in its contract: it returns the name and thread name for session keys.
- The threads module fills the port; composition wires them. Graph is below threads and does not import it (rule [[e090f46d]]).
- `read_journal` returns the name in every `JournalSession`.
- The test is an integration test on `read_journal`: an event written by a named thread arrives with that name.

## Acceptance

- The runlith journal opens with a title and caption, full width. Time absolute, days divided.
- Every row's author named by thread name.
- Three consecutive answers to one reflection — one `×3` row.
- No op codes in rows with a full dictionary.
- `read_journal` returns session names; the test passes.
