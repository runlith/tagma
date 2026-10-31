---
id: 01a193f8-0f6e-7d7b-ab47-f2ac80ffecb0
title: Roster
ord: 53
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/Roster.ts"
      },
      {
        "at": "src/RegistryClash.ts"
      },
      {
        "at": "src/cell.ts"
      },
      {
        "at": "src/cell.svelte.ts"
      }
    ],
    "id": "@runlith/roster",
    "kind": "kit"
  }
sources:
  - kind: dir
    ref: packages/roster
---
Contributions that many places add to a shared list need one answer to two contributors claiming the same key: refuse at once and name both, instead of letting the later one silently push the first out. The kit owns that keyed list — contributors add items and take them back with the disposer they were handed, a second holder of one key is refused naming both — and the reactivity hook it publishes through: a cell whose backend the host chooses, with the Svelte filler beside it. What the items are, and when a clash is reported to the user, stays with the caller.