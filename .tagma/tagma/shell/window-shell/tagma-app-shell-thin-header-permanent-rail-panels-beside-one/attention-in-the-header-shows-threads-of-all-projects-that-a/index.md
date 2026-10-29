---
id: 01a10891-853e-7f52-89f5-9e2c8f3cc5fd
title: “Attention” in the header shows threads of all projects that await a reply, failed, or finished unread
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Attention.svelte
  - kind: file
    ref: apps/tagma/server/src/threads/list/summary.ts
---
The “Attention” button in the header is one entry point for “what needs me right now” across every project on the machine. It holds threads that await a reply, failed, or finished while you were not looking.

## What exists

The server already knows each state on the thread row (`threads/contract/wire/list.ts`, `threads/list/summary.ts`):
- awaiting a reply: `life: 'awaiting'` with `ask` — question text, view, time;
- run failed or cut: `outcome.status` failed or cut, with `failure`;
- finished and unread: `outcome.status: 'completed'` and `!outcome.isSeen`. The read marker is `mark_thread_seen` (thread and run).

All of this is visible for one project only:
- `list_threads` and the `threads.subscribe` feed take one project;
- `Attention.svelte` draws “working” and “waiting on you” in the current project's column header;
- unread are counted (`attentionOf`) but not drawn;
- failed are not counted at all.

Every thread lives in one machine database, so reading across all projects is an addition to the store, not a new database.

## Server

The threads module declares in its manifest:
- **`read_attention`** — rows for the operator's threads in all projects that need a person. Row fields:
  - `project {id, name}`, `threadId`, `title`, `name`, `parentId`;
  - `kind: 'awaiting' | 'failed' | 'finished'` — `failed` covers both failed and cut;
  - `at` — `askedAt` or `finishedAt`;
  - `ask.text` — for `awaiting`;
  - short failure reading (`threadFailureReading`) — for `failed`.

  Inclusion rules:
  - `awaiting` — always;
  - `failed` — until the run is marked read;
  - `finished` — only root threads, like the current `unread` mark: children's outcomes arrive as their parent's report.

  Order — newest on top. The answer is a page with `total` and a cursor per rule [[68659e3b]].
- **`attention.subscribe`** feed — the same set live across the machine. Sends row changes so the header does not poll N projects.

Classification comes from `summary.ts` (`moveOf`, `askOf`) and is not written twice. The test is an integration test on `read_attention`: three threads in two projects yield three rows of the needed kinds, and after `mark_thread_seen` the `finished` row goes away.

## App

- **“Attention” button** in the header ([[54780672]]). The counter is `awaiting` plus `failed`; unread finished do not inflate the counter — they get a dot with no number.
- **Popover:**
  - Waiting for you, Failed, Done groups;
  - All projects or current switch;
  - row: name, project, question or failure text, time;
  - click opens the thread in its project: `threadHref(id, project)`; with panels, `⌥`-click opens beside;
  - the `Mark all read` button marks the `finished` and `failed` rows read.
- **Read marking.** Opening a thread marks it read, as now. With [[5c88840b]] every visible thread counts as read, not only the “main” one.
- **Agents column header.** Keeps the “N working” counter with a jump to the working threads. “Waiting on you” moves out of it into “Attention”. The `a` key — jump to the next waiting thread in the list — stays.

## Acceptance

- A thread of another project that asked a question appears in “Attention” without opening that project. The counter grows; clicking opens the thread in its project.
- A failed run is visible in Failed until read.
- A finished root thread is visible in Done until opened; children never appear there.
- `Mark all read` clears Done and Failed.
