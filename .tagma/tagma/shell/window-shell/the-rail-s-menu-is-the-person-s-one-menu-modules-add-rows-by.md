---
id: 01a1995d-606d-7a41-b5c6-ed845c4b5666
title: "The rail's menu is the person's one menu: modules add rows by place, and its mark is a port with a quiet fallback"
ord: 19
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/window/parts.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/AppMenu.svelte
---
The menu at the bottom of the rail holds what belongs to the person rather than to a project: settings, theme, keeping the machine awake, the project strip, and whatever a distribution adds about the person. A second button beside it was rejected: two menus of the same kind crowd the rail, and a build without the contributing module would carry an empty slot.

- **Rows by place.** A module adds rows through `MenuParts` and names where they stand: `head` above Settings, `go` beside it, `foot` after the view choices, closing the menu. The menu draws the separators of a place only when that place has rows, so the core's own menu is unchanged where no module contributes.
- **The mark is a port.** `MenuSignal` says whether something behind the menu waits on the person; the button then carries the blue "waits for you" dot. The core places a fallback answering no signal, so the core's builds read it with `use()` and a distribution replaces it from its own manifest. A point would not fit: the mark is one answer, not a list.
- **The icon is a person, never a picture or initials.** A photo brings colour and a lettered tile reads as a state, and both mean something else in Tagma's grammar.