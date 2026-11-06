---
id: 01a165d5-d5a5-785f-bfe2-a3acf0e82349
title: "The project tile is neutral, and its colour is a muted mark in the corner: colour in the dock means state, not project"
ord: 4
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a165b3-4050-7292-999c-e1cf18dd9e6b
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Tile.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/mark.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/Swatch.svelte
  - kind: file
    ref: apps/tagma/server/src/appearance/contract/wire/tagma.ts
---
The previous eight project colours were a rainbow of the same lightness and saturation as the state colours, and on nearly the same tones: a red project read as a failure, a blue one as "waits for you", a green one as "done", orange and olive argued with the amber of work and the gold of "you are here". So the project tile is neutral — letters on backing, the current tile flooded with `--primary` like a light helm on a dark icon — and the project colour stands as a small tile in the corner (`Tile`; a group's tile carries one per member, in group order, along its top edge: past the few that fit the marks shrink to share that edge, so a group of any size stays inside its tile) or in a frame (`Swatch`). The tile with letters stands only in the dock, where there is no name beside it; in lists next to a name — `Swatch`: letters there repeat the name, and a mark in the corner of a 20 px tile overlapped them.

`--project-1…8` are muted, well under the chroma of the state colours. A chromatic mark also stands at least 21° from every state tone; a neutral one, of chroma too low to read as a hue, like Tagma's seventh, may sit beside a state tone, since nothing in it reads as that state. The appearance filter holds every theme's marks to these conditions, so a theme's project colour never starts meaning state in the dock.
