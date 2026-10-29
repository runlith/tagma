---
id: 01a0ff2b-54ff-7f7f-91d2-8f56f07ab3f2
title: The thread-column filter shows conversation replicas from all projects and their context
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0ff2b-54ff-7f7f-91d2-8f52cc7f387c
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Column.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/tree.ts
---
The operator types a word into the thread-column filter and immediately sees conversation replicas from all projects where it sounded, with their context.

Today the filter (`Column.svelte`, `tree.ts` `matchThreads`) searches title, name, agent, and model among the current project's loaded rows.

## Behavior

- The same input is used. Name matches, as today, appear instantly and stand on top.
- On non-empty input a group "In conversations" appears below — this is `search_threads(projects: 'all')` from [[cc7f387c]]. The interface has no length threshold of its own: the search decides query fitness, and two-sign "黑山" reaches the server. A `query-too-short` refusal simply hides the group. Each hit shows:
  - the thread title;
  - the project, if not current;
  - the replica time;
  - a highlighted fragment;
  - the archive mark.
- New input cancels the in-flight request: no debounce, the last request wins.
- Under incomplete coverage the group says how many threads the index has not read yet.
- An empty result is labeled the same: with a coverage caveat if incomplete.
- Clicking a hit expands a ±3-replica window beneath it (`read_thread_record` with `conversation: true`) with highlighting. The "Open thread" button opens the thread the usual way, from the feed tail. Another project's thread opens in its project.
- Arrows and Enter walk hits just like rows.

Labels are the app's English strings, like the whole Tagma interface. Claude builds it under the UI/UX rule.

## Acceptance

- In the Montenegro scenario from [[cc7f387c]], the operator types "черногор" and in one step sees the replica, its neighbors, and the project.
- Another project's thread opens in its project.
