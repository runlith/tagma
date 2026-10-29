---
id: 01a179d9-f562-755e-a599-9bd0d928d094
title: In the project list the repository icon stands only on Team projects, the shared graph sits below next to New project, and only the list scrolls
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/ProjectList.svelte
---
A person needs the storage mode to tell which projects hand their graph to the repository. Stealth is the default on creation: the graph stays with the person. So the mark stands only on Team: a repository icon after the name, with a short tooltip on it saying what it means. A word on every row was rejected: with 13 projects that is 13 identical words competing with the names. A mode on the right was rejected too: one thing stands there, the current-project check or the agents' pulse. The tooltip hangs on the icon itself, not on the row: otherwise two would pop up on hover.

Shared graph stands in the bottom section next to New project. When it stood under the search field it read as part of the header, and the first row was not a project. Only the project list scrolls, so New project and Remove stay visible with any number of projects.
