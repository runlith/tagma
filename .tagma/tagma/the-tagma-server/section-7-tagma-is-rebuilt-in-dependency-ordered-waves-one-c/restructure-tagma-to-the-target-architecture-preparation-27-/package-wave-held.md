---
id: 01a0e569-e602-7860-a5df-15d80557b009
title: "Package wave: held"
ord: 43
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e533-8064-7d5a-81fb-ef815c9f98b7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-f876-7433-b54b-0ba8e4a0488f
---
The `held` card of section 7 part 2 ([[e4a0488f]]), with its vocabulary amendment [[1deb33b8]]. Owns this package's `modules` and `names` debt. Its order and waits-on edges follow section 6 ([[be799808]]) and are added with the package groups' schedule.

**Closing note.** `packages/held` landed in 1ee03c9836 with `holding`, `failures`, `Held`, `Flight`, `Capacity` and `Passes` as runtime entries (`node`/default conditions, no barrel), 18 unit tests, and its `modules` entry. Checked against the card: it needs no workspace package (the card permits `utils`; it imports only `effect`), persists nothing, and holds only mechanism; each declared resource stays its declarer's. Its first consumers are `platform/contract/service/capacity.ts` and the git kit's lanes and index section. The card's acceptance — the `held-resources` and `blocking-calls` rules at gate — belongs to builtin-modules' task. Its `#module` is written at the merge (merge list 4a9013bf), because the graph measures the main checkout where the package does not exist yet.