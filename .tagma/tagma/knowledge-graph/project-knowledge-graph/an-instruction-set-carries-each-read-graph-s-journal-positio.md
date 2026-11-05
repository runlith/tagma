---
id: 01a1ac92-0287-798b-b5f2-e6316ccf14aa
title: An instruction set carries each read graph's journal position, so the next diff names its changes' actors from the events after it
ord: 278
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632c6aeb5d45
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/orientation/Instructions.ts
---
The diff of two instruction sets says what changed, never who changed it, so a notice cannot name its actor from the sets alone. Each set therefore carries the journal position of every graph it read, read before that graph's law, and each law, tag and catalog entry carries the graph and block it came from. The next diff reads the authors of that block's journal events after the previous set's position: an event committed between the position and the law read is still counted, while one committed before the position is already in the previous set. Event ids, not times, bound the window: ids follow commit order within one store and range over the primary key, so the read costs only the events since the last delivery; event times are neither indexed nor commit-ordered.

A change is attributed only in a graph both sets read. A graph the thread no longer reaches left through a setting or a group's reach, which no block event explains, and opening it again could fail the step. Shipped tag text, a rename that only moves a scope label, and a setting that turns law on or off leave no block event in the window and arrive unattributed rather than credited to the block's last writer.
