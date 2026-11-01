---
id: 01a1974f-6704-7fe6-9c81-02ab181dc572
title: "The agent column always shows the open thread: a thread on screen outside the loaded window is held with its family, and the column unfolds and scrolls to it without taking focus"
ord: 34
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/List.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/shownFamilies.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ColumnState.svelte.ts
---
The column loads a window — the newest roots by the reader's last word, plus working, pinned and filed ones — and pages older roots behind "more". The palette, links and notifications open any thread of any age, so being on screen is a reason to hold a thread, like working or pinned; without it a thread opened from search had no row and the operator could not see where he stood.

Holding costs one read of the thread's family per opening, whatever the project's thread count. That read names the thread without an explicit project: the server resolves its home, which can differ from the column's group tile even before the list has seen the thread. A live thread joins at its place in the order, below the loaded part; an archived one joins the Archived rows. It is let go once no seat shows it: opening reorders nothing, only the operator's word moves a thread up.

A list frame from the server keeps a held family and reads it again, since events may have been lost before it. The column's own window refresh keeps the held family and every root "more" loaded, since its buffered frames lose nothing; dropping them made loaded rows vanish at the next root birth.

Following opens only what hides the row — a team, a stub, the pinned band, a folder, Archived — and scrolls without taking focus, so typing in the composer is never interrupted. A row already drawn, as the open thread is inside a closed folder or a finished stub, is only scrolled.
