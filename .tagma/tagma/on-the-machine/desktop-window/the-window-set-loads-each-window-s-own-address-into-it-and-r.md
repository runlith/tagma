---
id: 01a13d77-a1bd-7637-ab40-2458752bb367
title: The window set loads each window's own address into it and reports navigation to the loader only once every window stands on the surface
ord: 11
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/desktop/src/projectWindows.ts
---
`SurfaceLoader` is one per app and holds a single “surface open” flag: while it is raised, `openSurface` does not call the port. The window set therefore decides itself which window to load: `open` enters only windows that are not on the surface, each at its own address (that window's last app address), while `show` puts the waiting page in all of them. The set hands window navigation to the loader (`navigated`) only once every window is on the surface. Otherwise a second window's successful navigation would raise the flag while the first lies on a failed load, the loader would never call `open` again — and the first window would stay on the error.

A new window receives the loader's last word (`open` or the waiting page) at once, and a window opened into an empty set also starts the loader (`start`). Without the last word replayed, a window opened after the in-progress decision already said `open` would stay empty.

The loader's questions and main dialogs go over the window that last received focus. A new window goes to the front of the focus order and moves to the end only on its own `focus`, so a question asked before a new window is first shown does not leave for an invisible window.
