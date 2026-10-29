---
id: 01a118f1-5f59-7eb8-856a-a0e613bda205
title: "Thread list at scale: incremental tree, one row-life normalization, virtualized column"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Column.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/List.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/tree.ts
---
**Outcome.** The thread list stays fast with hundreds of threads in a project and dozens working at once. Changing one thread costs work on its node, the path to the root and its parent's order. The column renders the visible window and keeps everything it can do now.

**What now costs extra.**
- The tree rebuilds whole on every list-input change (`List.svelte.ts:139`, the `tree.ts:31-59` walk).
- A row holds its own work-label delay deadline (`rowReading.svelte.ts:54-67`) over the shared `WallClock`.
- `workLines` is a module singleton holding all projects' state (`workLines.svelte.ts:22`).
- The column renders all rows (`Column.svelte:467-521`).
- The thread command for pages assembles by walking the list (`features/pages/team.ts:9-25`).

What is already right and stays:
- the shared `WallClock` ticker (`features/workspace/WallClock.svelte.ts`);
- `CommandActivity` — one `commands.subscribe` subscription per project with a thread index (`features/executions/commands/Activity.svelte.ts:87,154-165,201-212,290-311`).

**Design.**
- **The tree is incremental.** A parent index holds children in order and their visibility. A row change (phase, label, title, parent, folder, pin) updates its node, the path to the root and, when the sort key moved, its place among neighbours by binary search, with no re-sort of all. The same index answers the "thread command" for pages.
- **Shared row-life facts are one normalization.** `RowLife` reduces native- and terminal-thread facts (`RunStatus`, terminal observability) to one form. The outcome and read marks (`Life.svelte`) and the timer start (`rowKind.ts`) stay separate projections over it: those are different questions. Now each of three places (`tree.ts:209`, `Life.svelte:9`, `rowKind.ts:8`) reads raw facts its own way.
- **The work-label delay** is one scheduler per list over `WallClock`, not a timer per row.
- **`workLines` belongs to the project** and lives as long as the project.
- **The column is virtualized.** Everything now depending on the rendered hierarchy (`Column.svelte:174-399`, `Row.svelte:268-328`) is kept:
  - folders;
  - pinned/live/quiet bands;
  - worktree grouping;
  - archive sections;
  - selection, drag and drop;
  - rename focus;
  - peeks;
  - "still working" stubs.

  State now living in a mounted row (rename focus, open peek) moves to the column owner. Key navigation and scroll-to-selected go by index, not DOM.

**How to check (performer).**
- List model (the public change-apply operation), 1000 threads:
  - one thread's phase change keeps every node identity outside its path;
  - a sort-key change moves the node without recreating neighbours;
  - a parent's width (500 children) never makes work proportional to child count — checked by a model bench with a ratio budget.
- A terminal and a native thread with identical facts give identical normalized life. A question and an unread outcome give different marks.
- A 1000-row column mounts only the window. Rename, drag and drop and peek work on a row scrolled out of the window and back.
- The whole list's frame budget is in the observer scenario ([[33589ccf]]).
