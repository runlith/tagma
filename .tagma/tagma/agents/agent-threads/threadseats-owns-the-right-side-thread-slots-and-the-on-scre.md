---
id: 01a15733-baab-76bf-9ae2-6035ccb75b42
title: ThreadSeats owns the right-side thread slots and the on-screen host, not the container
ord: 26
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/SidePanes.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/ThreadPlaces.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/seats/ThreadSeats.svelte.ts
---
Right-side thread behaviour — `reveal`, `openFrom`, `settle`, the thread slots — belongs to `ThreadSeats`, not the container: it also answers with the `ThreadOnScreen` port. A tab of another kind has no slot: while it is focused, `host` stays the last thread the operator worked in since last focusing the main one — it is led by the `SidePanes.trail` focus trail. That is why the thread kind is declared with `keep`: its tabs stay mounted but hidden while the area is shown; otherwise switching to the browser would unmount the slot and the element selected on the page would end up in the main thread. `shown` (read marks) counts only the visible thread tab as shown. A thread already shown as main or as a tab, when opened beside, reveals in place instead of duplicating; the opening answers `main` when the main one is revealed.

One `place` decides where a thread's thing lands: the shown screen's holder, when the thread is on it now and the thing belongs to this project (or the kind is `portable`), otherwise the thread's own layout. `SidePanes.openAt` opens at that place: on the shown screen — with focus and opening marks; in someone else's layout — silently. Terminals, files, pages and agent calls all go through it, so the rule never diverges between kinds. Features below threads (executions, speech, browser, pages) call `place`, `openFor` and `ask` through the panel module's `ThreadPlaces` port, which composition fills with this `ThreadSeats`: otherwise they would have to import the threads module, which itself stands on them; the decision is made at open time and recorded in the thing's owner, so a thing opened while the thread was on another screen stays with that screen's holder.
