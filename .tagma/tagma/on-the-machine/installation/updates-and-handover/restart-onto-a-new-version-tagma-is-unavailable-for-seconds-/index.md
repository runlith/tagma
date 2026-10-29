---
id: 01a12699-1673-714b-a6a5-79e65f9b619e
title: "Restart onto a new version: Tagma is unavailable for seconds, and that time does not grow with accumulated history"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
A person updates Tagma without interrupting their work: the new version downloads and prepares while they work, and Tagma is only unavailable for the restart — usually up to 5 seconds, at most 10, no matter how much history has accumulated. This spec answers for the restart itself and for what the server does when opening its stores. Where the new version comes from and how it is placed alongside is a separate installation spec; the seam between them is one: the installation directory already stands, and the server is asked to restart onto it.

## What the person gets

1. **One thing is asked of the person — consent to update.** No commands, checks, or knowledge of the database, migrations, server, and processes underneath: the program does everything itself; they started it and keep working.
1. **Work is not interrupted while the update prepares.** Everything that can be done with the server alive is done with the server alive.
2. **The window.** That is the span from when Tagma stops accepting acts to when the person can act again in the same place. Usually up to 5 seconds, ceiling 10.
3. **The window is visible.** The app and the browser tab show that Tagma is restarting and how long it takes; no dead page and no silent address.
4. **The same thread.** After the window the person stands in the same thread with the same draft. The feed opens at the end, as on a regular thread opening.
5. **Responsive at once.** After the window no operation waits on work deferred from the window: it runs in background portions or on demand for what the person opened.
6. **Agents continue on their own.** The restart does not wait for them. Terminals, background commands, and other CLIs' agents survive the server restart as today; the execution host itself changing without breaking executions is a separate delivery [[d86d6647]] this one does not wait for; an interrupted turn is picked up by the new server; a command an agent was waiting on is stopped by the server, and the agent starts it again.
7. **An honest exception.** An update that will not fit the ceiling says so before restarting and shows progress.

No absolute ceiling on any machine, under any load and failure, can be promised; what is promised is that overruns and failures are visible rather than looking like waiting.

## What stands today

Measurements on one machine (macOS 26, arm64), 22.7 GB database, 3204 threads; each one sample:

- **Short restart:** from channel break to door opening 8.4–9.9 s across four restarts (two applied small migrations; two without migrations — 8.4 and 9.1 s), plus 3.7–17.7 s more to start restoring running runs.
- **Restart with migrations:** `runtime composed` took 981.5 s on October 2 and 663.7 s on October 9. The migration operators themselves were about 30 s in the first case; the rest was the pre-migration snapshot, the full-database foreign-key check, and data steps walking every thread's journal.
- **The chain is 350 migrations;** of the last hundred, 22 cost as much as a thread journal or another history table.
- **The successor reports readiness before the database opens,** and the predecessor leaves after it: a migration failure leaves the machine with no server.

## The rule the rest stands on

**Nothing whose cost grows with accumulated history runs in the window** — event, message, call, and command counts, thread lengths, database size. Such work goes to one of two sides:

- **before the restart**, with the server alive: downloading, checking, preparing the successor;
- **after the restart**, on demand: what belongs to one thread is done when that thread is addressed.

There is no third side — "in the background over all history right after start": that is the same wait, only hidden.

The entity count — threads, blocks, projects — may enter the window: a migration may update a table with one row per thread, and that is milliseconds over thousands of rows. The length of the thread the person stands in does not enter: the feed window reads its frame, and the whole thread is brought to the new record shape after it.

## While the user is one

While the build is issued to nobody but the operator, earlier data shapes are not supported at all. Migrations and shape steps do not accumulate: what the operator's machine already passed folds into the base migration, and passed steps are deleted. Whatever stayed in the old shape by folding time and the server no longer opens is deleted as garbage. This spec's mechanisms are built for future users; "stays forever" starts with the first build issued to anyone else.

## Parts

The window and what the person sees:

- [[212d752c]] — what counts as the window, the restart record by phase, the budget and the measuring stand.
- [[9b246531]] — restart states, what leaves the span between doors, what happens on failure.
- [[6417e7fa]] — the starting server's answer before its stores open.
- [[d801f443]] — showing the window and returning to the same thread in the app, browser, CLI, and on the paired device.

Executions:

- [[d86d6647]] — the execution host changes together with the server, and executions survive the change.

Stores:

- [[9631d38c]] — the migration law, the key check and the snapshot by what the migration touches, the declared heavy update.
- [[8d4a4eb8]] — journal body shape per thread, on addressing it.
- [[842e3529]] — one base migration instead of 350 and a one-time conversion of existing stores.
- [[c3af42eb]] — in SQL, the journal of only the threads in work.

Build order is three lines. Stores: the key check from [[9631d38c]] → [[8d4a4eb8]] → [[842e3529]] → the law from [[9631d38c]] → [[c3af42eb]]. Shape steps are built before the base migration: it deletes the data steps, and after it no step changes body shapes. Window: [[212d752c]] → [[9b246531]] → [[d801f443]] → [[6417e7fa]]. Host: the [[d86d6647]] line goes on its own spec and lands independently; the rest of this spec's work does not wait for it and runs only in main. [[842e3529]] lands before the first build goes to anyone but the operator.

## What shows it works

**Proved by the performer** — each part has its own checks; the one shared check: the [[212d752c]] stand on its own server instance shows that the window, measured by client clocks, is no longer on a long-history set than on a short-history set — without migrations, with an entity-table migration, and with a new shape step while the client stands in a large thread.

**Checked by the operator** (not a task completion condition):

- Updating on their machine with a database over 20 GB: Tagma is unavailable for at most 10 s, and that time visibly shows a restart in progress.
- Updating while agents work: the runs continued on their own.
- After the update they stand in the same thread with the same draft, and a thread unopened for three weeks opens in the usual time.

## Out of scope

- **Version download, installation channels, signatures, and desktop shell updates** — the installation spec and [[3de8a8fa]]: it replaces the application whole and then asks for the same server restart.
- **The server's life owner** stays as is ([[c7d48051]], rule 3): the server restarts itself, handing the place to the successor. Supervised launchd ([[2e073431]]) stays an open idea.
- **macOS permissions** ([[c3dad364]]): a server restart does not change the application signature and touches no permissions.
- **Waiting on running work and commands surviving restarts.** The operator kept the current behaviour; [[959a4005]] (closed spec) takes apart the details.
- **Place in the feed.** After a reload the feed opens at the end.
- **Returning to the previous installation after a release migration that already served.** An attempt that never reached the door is rolled back by its release ([[1c89545b]]).
- **Resetting the repository's git history.**
